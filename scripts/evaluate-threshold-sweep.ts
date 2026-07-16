import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import type { EmbeddingCachePlan } from "../src/lib/rag/embedding-cache";
import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, validateGoldenSet, validateGoldenSetSplit, type GoldenCaseStatus } from "../src/lib/rag/golden-set";
import {
  aggregateRetrievalMetrics,
  evaluateRetrievalCase,
  matchesEvidence,
  type RankedChunk,
} from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

type ThresholdProtocol = {
  schemaVersion: 1;
  id: string;
  title: string;
  hypothesis: string;
  baseExperimentConfig: string;
  variedPath: "retrieval.minScore";
  thresholds: number[];
  selectionRule: {
    primary: "noAnswerFalsePositiveRate";
    primaryDirection: "lower";
    guardrails: Array<{ metric: "recallAtK" | "mrr"; minimum: number }>;
    tieBreakers: Array<{
      metric: "ndcgAtK" | "precisionAtK" | "threshold";
      direction: "higher" | "lower";
    }>;
  };
  readiness: { status: "exploratory" | "thesis-ready"; reason: string };
  reportOutput: string;
};

type ThresholdResult = {
  threshold: number;
  metrics: ReturnType<typeof aggregateRetrievalMetrics>;
  returnedChunks: number;
  cases: ReturnType<typeof evaluateRetrievalCase>[];
};

type SweepAttempt = {
  schemaVersion: 1;
  sweepId: string;
  attemptId: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  parentRunId: string;
  experimentId: string;
  readiness: ThresholdProtocol["readiness"];
  hypothesis: string;
  variedPath: "retrieval.minScore";
  inputHashes: { protocol: string; baseConfig: string; runConfig: string; chunks: string; goldenSet: string; splitManifest: string };
  code: { gitCommit: string; dirty: boolean; gitDiffHash: string };
  controlledConfiguration: {
    chunking: ExperimentConfig["chunking"];
    embedding: ExperimentConfig["embedding"];
    retrievalStrategy: string;
    topK: number;
    caseStatuses: GoldenCaseStatus[];
    split: "validation";
  };
  caseSelection: { selected: number; answerable: number; unanswerable: number };
  cache?: {
    documents: EmbeddingCachePlan & { apiInputs: number; apiRequests: number };
    queries: EmbeddingCachePlan & { apiInputs: number; apiRequests: number };
  };
  scoreDiagnostics?: {
    maximumUnanswerableTopScore: number | null;
    minimumAnswerableTopScore: number | null;
    minimumAnswerableKthScore: number | null;
  };
  results?: ThresholdResult[];
  selectedThreshold?: number | null;
  selectionReason?: string;
  timingsMs?: { cacheLoadAndEmbedding: number; scoring: number; sweep: number; total: number };
  error?: string;
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const startedAt = performance.now();
  const options = parseArgs(process.argv.slice(2));
  const protocolPath = path.resolve(options.protocol);
  const runDirectory = path.resolve(options.run);
  const protocolRaw = await fs.readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw) as ThresholdProtocol;
  validateProtocol(protocol);
  const baseConfigPath = path.resolve(path.dirname(protocolPath), protocol.baseExperimentConfig);
  const baseConfigRaw = await fs.readFile(baseConfigPath, "utf8");
  const runRaw = await fs.readFile(path.join(runDirectory, "run.json"), "utf8");
  const runConfigRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const run = JSON.parse(runRaw) as ExperimentRun;
  const config = JSON.parse(runConfigRaw) as ExperimentConfig;
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (run.status !== "prepared") throw new Error(`Parent run ${run.runId} is not prepared.`);
  if (sha256(canonicalJson(baseConfigRaw)) !== sha256(canonicalJson(runConfigRaw))) {
    throw new Error("The prepared run configuration does not match the protocol base configuration.");
  }
  if (!config.evaluation.goldenSet) throw new Error("Base experiment must define evaluation.goldenSet.");
  if (!config.evaluation.splitManifest || config.evaluation.split !== "validation") {
    throw new Error("Threshold calibration requires evaluation.split='validation' and a split manifest.");
  }

  const goldenRaw = await fs.readFile(path.resolve(config.evaluation.goldenSet), "utf8");
  const goldenSet = await loadGoldenSet(config.evaluation.goldenSet);
  const validation = await validateGoldenSet(goldenSet);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  const splitRaw = await fs.readFile(path.resolve(config.evaluation.splitManifest), "utf8");
  const splitManifest = await loadGoldenSetSplit(config.evaluation.splitManifest);
  const splitValidation = validateGoldenSetSplit(goldenSet, splitManifest);
  if (splitValidation.errors.length) throw new Error(splitValidation.errors.join("\n"));
  const allowedStatuses = (config.evaluation.caseStatuses ?? ["human-approved"]) as GoldenCaseStatus[];
  const selectedCases = selectGoldenSplit(goldenSet, splitManifest, "validation")
    .filter((testCase) => allowedStatuses.includes(testCase.status))
    .filter(
      (testCase) =>
        testCase.answerability === "unanswerable" ||
        testCase.evidence.some((evidence) => chunks.some((chunk) => matchesEvidence(chunk, evidence))),
    );
  if (!selectedCases.length) throw new Error("No golden-set cases apply to the prepared corpus.");

  const createdAt = new Date().toISOString();
  const attemptId = createdAt.replace(/[-:.TZ]/g, "").slice(0, 17);
  const attemptDirectory = path.join(runDirectory, "threshold-sweeps", protocol.id, attemptId);
  const provenancePaths = ["src", "scripts", "package.json", "package-lock.json", "docs/experiments", "docs/evaluation"];
  const gitStatus = runCommand("git", ["status", "--porcelain", "--", ...provenancePaths]);
  const gitDiff = runCommand("git", ["diff", "--binary", "--", ...provenancePaths]);
  const attempt: SweepAttempt = {
    schemaVersion: 1,
    sweepId: protocol.id,
    attemptId,
    status: "running",
    createdAt,
    parentRunId: run.runId,
    experimentId: run.experimentId,
    readiness: protocol.readiness,
    hypothesis: protocol.hypothesis,
    variedPath: protocol.variedPath,
    inputHashes: {
      protocol: sha256(protocolRaw),
      baseConfig: sha256(baseConfigRaw),
      runConfig: sha256(runConfigRaw),
      chunks: sha256(chunksRaw),
      goldenSet: sha256(goldenRaw),
      splitManifest: sha256(splitRaw),
    },
    code: {
      gitCommit: runCommand("git", ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitStatus),
      gitDiffHash: sha256(gitDiff),
    },
    controlledConfiguration: {
      chunking: config.chunking,
      embedding: config.embedding,
      retrievalStrategy: config.retrieval.strategy,
      topK: config.retrieval.topK,
      caseStatuses: allowedStatuses,
      split: "validation",
    },
    caseSelection: {
      selected: selectedCases.length,
      answerable: selectedCases.filter((testCase) => testCase.answerability === "answerable").length,
      unanswerable: selectedCases.filter((testCase) => testCase.answerability === "unanswerable").length,
    },
  };
  await fs.mkdir(attemptDirectory, { recursive: true });
  await writeAttempt(attemptDirectory, attempt);

  try {
    const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
    const cacheStartedAt = performance.now();
    const documentResult = await embedTextsWithCache(
      chunks.map((chunk) => `${chunk.section}\n${chunk.content}`),
      {
        model: config.embedding.model,
        taskType: config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT",
        outputDimensionality: config.embedding.outputDimensionality,
        titles: chunks.map((chunk) => chunk.title),
        batchSize: config.embedding.batchSize,
        allowProviderRequests: false,
      },
    );
    const queryResult = await embedTextsWithCache(selectedCases.map((testCase) => testCase.question), {
      model: config.embedding.model,
      taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING",
      outputDimensionality: config.embedding.outputDimensionality,
      batchSize: config.embedding.batchSize,
      allowProviderRequests: false,
    });
    const cacheLoadAndEmbedding = Math.round(performance.now() - cacheStartedAt);
    attempt.cache = {
      documents: { ...documentResult.cache, apiInputs: documentResult.apiInputs, apiRequests: documentResult.apiRequests },
      queries: { ...queryResult.cache, apiInputs: queryResult.apiInputs, apiRequests: queryResult.apiRequests },
    };

    const scoringStartedAt = performance.now();
    const candidates = selectedCases.map((_, caseIndex) =>
      chunks
        .map((chunk, chunkIndex) => ({
          ...chunk,
          score: cosineSimilarity(queryResult.vectors[caseIndex], documentResult.vectors[chunkIndex]),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, config.retrieval.topK),
    );
    const scoring = Math.round(performance.now() - scoringStartedAt);
    attempt.scoreDiagnostics = scoreDiagnostics(selectedCases, candidates);

    const sweepStartedAt = performance.now();
    attempt.results = protocol.thresholds.map((threshold) => {
      const cases = selectedCases.map((testCase, caseIndex) => {
        const rankedChunks: RankedChunk[] = candidates[caseIndex]
          .filter((chunk) => chunk.score >= threshold)
          .map((chunk, index) => ({ ...chunk, rank: index + 1, score: Number(chunk.score.toFixed(6)) }));
        return evaluateRetrievalCase(testCase, rankedChunks);
      });
      return {
        threshold,
        metrics: aggregateRetrievalMetrics(cases),
        returnedChunks: cases.reduce((total, result) => total + result.retrievedCount, 0),
        cases,
      };
    });
    const selection = selectThreshold(attempt.results, protocol);
    attempt.selectedThreshold = selection.threshold;
    attempt.selectionReason = selection.reason;
    attempt.timingsMs = {
      cacheLoadAndEmbedding,
      scoring,
      sweep: Math.round(performance.now() - sweepStartedAt),
      total: Math.round(performance.now() - startedAt),
    };
    attempt.status = "completed";
    attempt.completedAt = new Date().toISOString();
    await fs.writeFile(path.join(attemptDirectory, "case-results.json"), `${JSON.stringify(attempt.results, null, 2)}\n`);
    await fs.writeFile(path.join(attemptDirectory, "summary.md"), renderMarkdown(attempt));
    if (options.writeReport) await writeVersionedReport(protocol, attempt);
  } catch (error) {
    attempt.status = "failed";
    attempt.completedAt = new Date().toISOString();
    attempt.error = error instanceof Error ? error.message : "Unknown threshold sweep failure.";
  }

  await writeAttempt(attemptDirectory, attempt);
  await fs.appendFile(
    path.join(runDirectory, "threshold-sweeps", protocol.id, "index.jsonl"),
    `${JSON.stringify(attempt)}\n`,
  );
  console.log(`${attempt.status.toUpperCase()} ${protocol.id}/${attempt.attemptId}`);
  console.log(`Selected threshold: ${attempt.selectedThreshold ?? "none"}`);
  console.log(`Wrote ${attemptDirectory}`);
  if (attempt.error) throw new Error(attempt.error);
}

function scoreDiagnostics(
  cases: Awaited<ReturnType<typeof loadGoldenSet>>["cases"],
  candidates: Array<Array<DocumentationChunk & { score: number }>>,
) {
  const unanswerableTop = cases
    .map((testCase, index) => (testCase.answerability === "unanswerable" ? candidates[index][0]?.score : undefined))
    .filter((score): score is number => score !== undefined);
  const answerableTop = cases
    .map((testCase, index) => (testCase.answerability === "answerable" ? candidates[index][0]?.score : undefined))
    .filter((score): score is number => score !== undefined);
  const answerableKth = cases
    .map((testCase, index) =>
      testCase.answerability === "answerable" ? candidates[index][candidates[index].length - 1]?.score : undefined,
    )
    .filter((score): score is number => score !== undefined);
  return {
    maximumUnanswerableTopScore: maximum(unanswerableTop),
    minimumAnswerableTopScore: minimum(answerableTop),
    minimumAnswerableKthScore: minimum(answerableKth),
  };
}

function selectThreshold(results: ThresholdResult[], protocol: ThresholdProtocol) {
  const eligible = results.filter((result) =>
    protocol.selectionRule.guardrails.every((guardrail) => {
      const value = result.metrics[guardrail.metric];
      return value !== null && value >= guardrail.minimum;
    }),
  );
  const zeroFalsePositive = eligible.filter((result) => result.metrics.noAnswerFalsePositiveRate === 0);
  const candidates = zeroFalsePositive.length ? zeroFalsePositive : eligible;
  const selected = [...candidates].sort((left, right) => {
    for (const tieBreaker of protocol.selectionRule.tieBreakers) {
      const leftValue = tieBreaker.metric === "threshold" ? left.threshold : left.metrics[tieBreaker.metric];
      const rightValue = tieBreaker.metric === "threshold" ? right.threshold : right.metrics[tieBreaker.metric];
      if (leftValue === rightValue) continue;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return tieBreaker.direction === "higher" ? rightValue - leftValue : leftValue - rightValue;
    }
    return 0;
  })[0];
  if (!selected) return { threshold: null, reason: "No threshold satisfied the predeclared guardrails." };
  return {
    threshold: selected.threshold,
    reason: zeroFalsePositive.length
      ? "Lowest-ranked candidate after requiring zero no-answer false positives and applying the declared guardrails and tie-breakers."
      : "No threshold eliminated false positives; selected the best candidate that satisfied the guardrails.",
  };
}

function renderMarkdown(attempt: SweepAttempt) {
  const rows = (attempt.results ?? []).map((result) =>
    `| ${result.threshold.toFixed(2)} | ${format(result.metrics.recallAtK)} | ${format(result.metrics.precisionAtK)} | ${format(result.metrics.mrr)} | ${format(result.metrics.ndcgAtK)} | ${format(result.metrics.noAnswerFalsePositiveRate)} | ${result.returnedChunks} |`,
  );
  return `# Threshold sweep ${attempt.attemptId}

- Status: **${attempt.status}**
- Base experiment/run: \`${attempt.experimentId}\` / \`${attempt.parentRunId}\`
- Readiness: **${attempt.readiness.status}** - ${attempt.readiness.reason}
- Calibration split: **validation** (${attempt.caseSelection.answerable} answerable + ${attempt.caseSelection.unanswerable} unanswerable)
- Selected threshold: **${attempt.selectedThreshold ?? "none"}**
- Selection: ${attempt.selectionReason ?? "not available"}
- Cache-only: ${attempt.cache?.documents.apiInputs === 0 && attempt.cache?.queries.apiInputs === 0 ? "yes" : "no"}

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
${rows.join("\n")}

Score diagnostics: maximum unanswerable top score ${format(attempt.scoreDiagnostics?.maximumUnanswerableTopScore ?? null)}, minimum answerable top score ${format(attempt.scoreDiagnostics?.minimumAnswerableTopScore ?? null)}, and minimum answerable fourth score ${format(attempt.scoreDiagnostics?.minimumAnswerableKthScore ?? null)}.

The threshold is selected exclusively on the validation split. The locked test split must be evaluated once, after this choice is recorded, and must not be used to revise the threshold.
`;
}

async function writeVersionedReport(protocol: ThresholdProtocol, attempt: SweepAttempt) {
  const outputBase = path.resolve(protocol.reportOutput);
  await fs.mkdir(path.dirname(outputBase), { recursive: true });
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(attempt));
  const header = ["threshold", "recall_at_k", "precision_at_k", "mrr", "ndcg_at_k", "no_answer_false_positive_rate", "returned_chunks"];
  const rows = (attempt.results ?? []).map((result) => [
    result.threshold,
    result.metrics.recallAtK ?? "",
    result.metrics.precisionAtK ?? "",
    result.metrics.mrr ?? "",
    result.metrics.ndcgAtK ?? "",
    result.metrics.noAnswerFalsePositiveRate ?? "",
    result.returnedChunks,
  ]);
  await fs.writeFile(`${outputBase}.csv`, [header, ...rows].map((row) => row.join(",")).join("\n") + "\n");
}

function validateProtocol(protocol: ThresholdProtocol) {
  if (protocol.schemaVersion !== 1) throw new Error("Unsupported threshold protocol schema version.");
  if (protocol.variedPath !== "retrieval.minScore") throw new Error("Threshold sweep may vary only retrieval.minScore.");
  if (!protocol.thresholds.length || protocol.thresholds.some((value) => value < -1 || value > 1)) {
    throw new Error("Thresholds must contain values between -1 and 1.");
  }
  if (new Set(protocol.thresholds).size !== protocol.thresholds.length) {
    throw new Error("Threshold grid contains duplicate values.");
  }
}

async function writeAttempt(directory: string, attempt: SweepAttempt) {
  await fs.writeFile(path.join(directory, "sweep.json"), `${JSON.stringify(attempt, null, 2)}\n`);
}

function minimum(values: number[]) {
  return values.length ? Math.min(...values) : null;
}

function maximum(values: number[]) {
  return values.length ? Math.max(...values) : null;
}

function format(value: number | null) {
  return value === null ? "n/a" : value.toFixed(4);
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: string) {
  return JSON.stringify(JSON.parse(value));
}

function parseArgs(args: string[]) {
  const runIndex = args.findIndex((arg) => arg === "--run" || arg === "-r");
  const protocolIndex = args.findIndex((arg) => arg === "--protocol" || arg === "-p");
  const run = runIndex >= 0 ? args[runIndex + 1] : undefined;
  if (!run) throw new Error("Usage: tsx scripts/evaluate-threshold-sweep.ts --run <prepared-run> [--write-report]");
  return {
    run,
    protocol:
      protocolIndex >= 0
        ? args[protocolIndex + 1]
        : "docs/experiments/common-programming-threshold-sweep.v2.json",
    writeReport: args.includes("--write-report"),
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
