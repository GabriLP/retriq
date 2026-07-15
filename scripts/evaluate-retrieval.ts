import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import type { EmbeddingCachePlan } from "../src/lib/rag/embedding-cache";
import { loadGoldenSet, validateGoldenSet, type GoldenCaseStatus } from "../src/lib/rag/golden-set";
import {
  aggregateRetrievalMetrics,
  evaluateRetrievalCase,
  matchesEvidence,
  type RankedChunk,
} from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

type Attempt = {
  schemaVersion: 2;
  attemptId: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  parentRunId: string;
  experimentId: string;
  inputHashes: { config: string; chunks: string; goldenSet: string };
  code: { gitCommit: string; dirty: boolean; gitDiffHash: string };
  configuration: {
    embeddingModel: string;
    retrievalStrategy: string;
    topK: number;
    minScore: number;
    caseStatuses: GoldenCaseStatus[];
  };
  corpus: { chunks: number; embeddedTexts: number; embeddingDimension?: number };
  embeddings?: {
    documents: EmbeddingCachePlan & { apiRequests: number; cacheWrites: number };
    queries: EmbeddingCachePlan & { apiRequests: number; cacheWrites: number };
    total: EmbeddingTotals;
  };
  caseSelection: { selected: number; excludedDraftOrStatus: number; excludedOutsideCorpus: number };
  timingsMs?: { embedding: number; retrieval: number; total: number };
  metrics?: ReturnType<typeof aggregateRetrievalMetrics>;
  error?: string;
};

type EmbeddingTotals = {
  requestedTexts: number;
  uniqueTexts: number;
  cacheHits: number;
  cacheMisses: number;
  apiRequests: number;
  cacheWrites: number;
  estimatedApiTokens: number;
  estimatedAvoidedTokens: number;
  estimatedApiCostUsd: number | null;
  estimatedAvoidedCostUsd: number | null;
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const startedAt = performance.now();
  const runDirectory = path.resolve(readRunPath(process.argv.slice(2)));
  const runRaw = await fs.readFile(path.join(runDirectory, "run.json"), "utf8");
  const run = JSON.parse(runRaw) as ExperimentRun;
  if (run.status !== "prepared") throw new Error(`Parent run ${run.runId} is not prepared.`);

  const configRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (config.embedding.provider !== "google") {
    throw new Error(`Embedding provider '${config.embedding.provider}' is not implemented.`);
  }
  if (config.retrieval.strategy !== "dense-cosine") {
    throw new Error(`Retrieval strategy '${config.retrieval.strategy}' is not implemented.`);
  }
  if (!config.evaluation.goldenSet) throw new Error("Experiment config must define evaluation.goldenSet.");

  const goldenRaw = await fs.readFile(path.resolve(config.evaluation.goldenSet), "utf8");
  const goldenSet = await loadGoldenSet(config.evaluation.goldenSet);
  const validation = await validateGoldenSet(goldenSet);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  const allowedStatuses = (config.evaluation.caseStatuses ?? ["human-approved"]) as GoldenCaseStatus[];
  const statusSelected = goldenSet.cases.filter((testCase) => allowedStatuses.includes(testCase.status));
  const selectedCases = statusSelected.filter(
    (testCase) =>
      testCase.answerability === "unanswerable" ||
      testCase.evidence.some((evidence) => chunks.some((chunk) => matchesEvidence(chunk, evidence))),
  );

  const createdAt = new Date().toISOString();
  const attemptId = `${createdAt.replace(/[-:.TZ]/g, "").slice(0, 17)}-${slug(config.embedding.model)}`;
  const attemptDirectory = path.join(runDirectory, "retrieval-attempts", attemptId);
  const provenancePaths = [
    "src",
    "scripts",
    "package.json",
    "package-lock.json",
    "docs/corpus",
    "docs/experiments",
    "docs/evaluation",
  ];
  const gitStatus = runCommand("git", ["status", "--porcelain", "--", ...provenancePaths]);
  const gitDiff = runCommand("git", ["diff", "--binary", "--", ...provenancePaths]);
  const attempt: Attempt = {
    schemaVersion: 2,
    attemptId,
    status: "running",
    createdAt,
    parentRunId: run.runId,
    experimentId: run.experimentId,
    inputHashes: {
      config: sha256(configRaw),
      chunks: sha256(chunksRaw),
      goldenSet: sha256(goldenRaw),
    },
    code: {
      gitCommit: runCommand("git", ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitStatus),
      gitDiffHash: sha256(gitDiff),
    },
    configuration: {
      embeddingModel: config.embedding.model,
      retrievalStrategy: config.retrieval.strategy,
      topK: config.retrieval.topK,
      minScore: config.retrieval.minScore,
      caseStatuses: allowedStatuses,
    },
    corpus: { chunks: chunks.length, embeddedTexts: chunks.length + selectedCases.length },
    caseSelection: {
      selected: selectedCases.length,
      excludedDraftOrStatus: goldenSet.cases.length - statusSelected.length,
      excludedOutsideCorpus: statusSelected.length - selectedCases.length,
    },
  };
  await fs.mkdir(attemptDirectory, { recursive: true });
  await writeAttempt(attemptDirectory, attempt);

  try {
    if (!selectedCases.length) throw new Error("No golden-set cases apply to the parent run corpus.");
    const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
    const embeddingStartedAt = performance.now();
    const chunkTexts = chunks.map((chunk) => `${chunk.title}\n${chunk.section}\n${chunk.content}`);
    const documentResult = await embedTextsWithCache(chunkTexts, {
      model: config.embedding.model,
      concurrency: 4,
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: config.embedding.outputDimensionality,
    });
    const queryResult = await embedTextsWithCache(selectedCases.map((item) => item.question), {
      model: config.embedding.model,
      concurrency: 4,
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: config.embedding.outputDimensionality,
    });
    const embedding = Math.round(performance.now() - embeddingStartedAt);
    const chunkVectors = documentResult.vectors;
    const queryVectors = queryResult.vectors;
    attempt.corpus.embeddingDimension = chunkVectors[0]?.length;
    attempt.embeddings = {
      documents: { ...documentResult.cache, apiRequests: documentResult.apiRequests, cacheWrites: documentResult.cacheWrites },
      queries: { ...queryResult.cache, apiRequests: queryResult.apiRequests, cacheWrites: queryResult.cacheWrites },
      total: combineEmbeddingReports(documentResult, queryResult),
    };

    const retrievalStartedAt = performance.now();
    const results = selectedCases.map((testCase, caseIndex) => {
      const rankedChunks: RankedChunk[] = chunks
        .map((chunk, chunkIndex) => ({
          ...chunk,
          score: cosineSimilarity(queryVectors[caseIndex], chunkVectors[chunkIndex]),
        }))
        .filter((chunk) => chunk.score >= config.retrieval.minScore)
        .sort((left, right) => right.score - left.score)
        .slice(0, config.retrieval.topK)
        .map((chunk, index) => ({ ...chunk, rank: index + 1, score: Number(chunk.score.toFixed(6)) }));
      return evaluateRetrievalCase(testCase, rankedChunks);
    });
    const retrieval = Math.round(performance.now() - retrievalStartedAt);
    attempt.metrics = aggregateRetrievalMetrics(results);
    attempt.timingsMs = { embedding, retrieval, total: Math.round(performance.now() - startedAt) };
    attempt.status = "completed";
    attempt.completedAt = new Date().toISOString();
    await fs.writeFile(path.join(attemptDirectory, "case-results.json"), JSON.stringify(results, null, 2));
    await fs.writeFile(path.join(attemptDirectory, "summary.md"), renderSummary(attempt));
  } catch (error) {
    attempt.status = "failed";
    attempt.completedAt = new Date().toISOString();
    attempt.error = error instanceof Error ? error.message : "Unknown retrieval evaluation failure.";
  }

  await writeAttempt(attemptDirectory, attempt);
  await fs.appendFile(path.join(runDirectory, "retrieval-attempts", "index.jsonl"), `${JSON.stringify(attempt)}\n`);
  console.log(`${attempt.status.toUpperCase()} ${run.experimentId}/${run.runId}/${attempt.attemptId}`);
  console.log(`Wrote ${attemptDirectory}`);
  if (attempt.error) throw new Error(attempt.error);
}

function renderSummary(attempt: Attempt) {
  const metrics = attempt.metrics;
  return `# Retrieval attempt ${attempt.attemptId}

- Experiment: \`${attempt.experimentId}\`
- Parent run: \`${attempt.parentRunId}\`
- Status: **${attempt.status}**
- Embedding: ${attempt.configuration.embeddingModel}
- Retrieval: ${attempt.configuration.retrievalStrategy}, top-k ${attempt.configuration.topK}, threshold ${attempt.configuration.minScore}
- Cases: ${attempt.caseSelection.selected} selected, ${attempt.caseSelection.excludedOutsideCorpus} outside corpus, ${attempt.caseSelection.excludedDraftOrStatus} excluded by review state
- Git: \`${attempt.code.gitCommit}\`${attempt.code.dirty ? " (dirty workspace)" : ""}

## Embedding cache and estimated usage

| Requested texts | Cache hits | API requests | Cache writes | Estimated API tokens | Estimated avoided tokens | Estimated API cost (USD) | Estimated avoided cost (USD) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| ${attempt.embeddings?.total.requestedTexts ?? "—"} | ${attempt.embeddings?.total.cacheHits ?? "—"} | ${attempt.embeddings?.total.apiRequests ?? "—"} | ${attempt.embeddings?.total.cacheWrites ?? "—"} | ${attempt.embeddings?.total.estimatedApiTokens ?? "—"} | ${attempt.embeddings?.total.estimatedAvoidedTokens ?? "—"} | ${formatCost(attempt.embeddings?.total.estimatedApiCostUsd)} | ${formatCost(attempt.embeddings?.total.estimatedAvoidedCostUsd)} |

Token and cost figures are estimates. Cost remains unavailable until a provider price is explicitly recorded in the environment.

| Recall@k | Precision@k | MRR | nDCG@k | No-answer false-positive rate |
|---:|---:|---:|---:|---:|
| ${formatMetric(metrics?.recallAtK)} | ${formatMetric(metrics?.precisionAtK)} | ${formatMetric(metrics?.mrr)} | ${formatMetric(metrics?.ndcgAtK)} | ${formatMetric(metrics?.noAnswerFalsePositiveRate)} |

These metrics evaluate source/page evidence retrieval. They do not measure final answer quality.
`;
}

function combineEmbeddingReports(
  ...reports: Array<{ cache: EmbeddingCachePlan; apiRequests: number; cacheWrites: number }>
): EmbeddingTotals {
  const pricesKnown = reports.every((report) => report.cache.estimatedApiCostUsd !== null);
  return {
    requestedTexts: sum(reports, (report) => report.cache.requestedTexts),
    uniqueTexts: sum(reports, (report) => report.cache.uniqueTexts),
    cacheHits: sum(reports, (report) => report.cache.cacheHits),
    cacheMisses: sum(reports, (report) => report.cache.cacheMisses),
    apiRequests: sum(reports, (report) => report.apiRequests),
    cacheWrites: sum(reports, (report) => report.cacheWrites),
    estimatedApiTokens: sum(reports, (report) => report.cache.estimatedApiTokens),
    estimatedAvoidedTokens: sum(reports, (report) => report.cache.estimatedAvoidedTokens),
    estimatedApiCostUsd: pricesKnown
      ? sum(reports, (report) => report.cache.estimatedApiCostUsd ?? 0)
      : null,
    estimatedAvoidedCostUsd: pricesKnown
      ? sum(reports, (report) => report.cache.estimatedAvoidedCostUsd ?? 0)
      : null,
  };
}

function sum<T>(items: T[], select: (item: T) => number) {
  return items.reduce((total, item) => total + select(item), 0);
}

function formatCost(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toFixed(6);
}

function formatMetric(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toFixed(4);
}

async function writeAttempt(directory: string, attempt: Attempt) {
  await fs.writeFile(path.join(directory, "attempt.json"), JSON.stringify(attempt, null, 2));
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32);
}

function readRunPath(args: string[]) {
  const index = args.findIndex((arg) => arg === "--run" || arg === "-r");
  const runPath = index >= 0 ? args[index + 1] : undefined;
  if (!runPath) throw new Error("Usage: tsx scripts/evaluate-retrieval.ts --run <experiment-run-directory>");
  return runPath;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
