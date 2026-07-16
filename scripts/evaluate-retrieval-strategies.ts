import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, validateGoldenSet, validateGoldenSetSplit, type GoldenCase } from "../src/lib/rag/golden-set";
import { Bm25Index, reciprocalRankFusion, type ScoredChunk } from "../src/lib/rag/retrieval-strategies";
import { aggregateRetrievalMetrics, evaluateRetrievalCase, matchesEvidence, type RankedChunk } from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

type StrategyId = "dense-cosine" | "bm25" | "hybrid-rrf";
type Protocol = {
  schemaVersion: 1;
  id: string;
  title: string;
  hypothesis: string;
  baseExperimentConfig: string;
  split: "validation";
  topK: number;
  candidateDepth: number;
  strategies: Array<{ id: StrategyId; parameters?: { k1?: number; b?: number; rankConstant?: number }; thresholds: number[] }>;
  selectionRule: {
    primary: "noAnswerFalsePositiveRate";
    primaryTarget: number;
    guardrails: { recallAtK: number; mrr: number };
    tieBreakers: string[];
  };
  controlledVariables: string[];
  reportOutput: string;
};

type Metrics = ReturnType<typeof aggregateRetrievalMetrics>;
type ThresholdResult = { threshold: number; metrics: Metrics; returnedChunks: number };
type StrategyResult = {
  strategy: StrategyId;
  parameters: Record<string, number>;
  scoringMs: number;
  rankingOnly: Metrics;
  rankingOnlyCases: ReturnType<typeof evaluateRetrievalCase>[];
  thresholdResults: ThresholdResult[];
  selectedThreshold: number | null;
  selectedMetrics: Metrics | null;
  decision: string;
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const protocolPath = path.resolve(options.protocol);
  const runDirectory = path.resolve(options.run);
  const protocolRaw = await fs.readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw) as Protocol;
  validateProtocol(protocol);
  const run = JSON.parse(await fs.readFile(path.join(runDirectory, "run.json"), "utf8")) as ExperimentRun;
  const configRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (run.status !== "prepared") throw new Error("The parent run must be prepared.");
  if (config.evaluation.split !== "validation" || !config.evaluation.splitManifest || !config.evaluation.goldenSet) {
    throw new Error("Retrieval strategy selection is restricted to a configured validation split.");
  }
  const baseConfigRaw = await fs.readFile(path.resolve(path.dirname(protocolPath), protocol.baseExperimentConfig), "utf8");
  if (canonicalJson(baseConfigRaw) !== canonicalJson(configRaw)) throw new Error("Prepared run does not match the protocol base configuration.");

  const goldenRaw = await fs.readFile(path.resolve(config.evaluation.goldenSet), "utf8");
  const splitRaw = await fs.readFile(path.resolve(config.evaluation.splitManifest), "utf8");
  const golden = await loadGoldenSet(config.evaluation.goldenSet);
  const split = await loadGoldenSetSplit(config.evaluation.splitManifest);
  const goldenValidation = await validateGoldenSet(golden);
  const splitValidation = validateGoldenSetSplit(golden, split);
  if (goldenValidation.errors.length || splitValidation.errors.length) throw new Error([...goldenValidation.errors, ...splitValidation.errors].join("\n"));
  const statuses = new Set(config.evaluation.caseStatuses ?? ["human-approved"]);
  const cases = selectGoldenSplit(golden, split, "validation")
    .filter((item) => statuses.has(item.status as "source-verified" | "human-approved"))
    .filter((item) => item.answerability === "unanswerable" || item.evidence.some((evidence) => chunks.some((chunk) => matchesEvidence(chunk, evidence))));
  if (!cases.length) throw new Error("No validation cases apply to this corpus snapshot.");

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const embeddingStarted = performance.now();
  const [documents, queries] = await Promise.all([
    embedTextsWithCache(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), {
      provider: config.embedding.provider as "google" | "openai" | "voyage",
      model: config.embedding.model,
      taskType: config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT",
      outputDimensionality: config.embedding.outputDimensionality,
      titles: chunks.map((chunk) => chunk.title),
      batchSize: config.embedding.batchSize,
      allowProviderRequests: false,
    }),
    embedTextsWithCache(cases.map((item) => item.question), {
      provider: config.embedding.provider as "google" | "openai" | "voyage",
      model: config.embedding.model,
      taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING",
      outputDimensionality: config.embedding.outputDimensionality,
      batchSize: config.embedding.batchSize,
      allowProviderRequests: false,
    }),
  ]);
  const embeddingMs = Math.round(performance.now() - embeddingStarted);
  const denseRankings = timeRankings(() => cases.map((_, caseIndex) => chunks
    .map((chunk, chunkIndex) => ({ ...chunk, score: cosineSimilarity(queries.vectors[caseIndex], documents.vectors[chunkIndex]) }))
    .sort(compareScores)
    .slice(0, protocol.candidateDepth)));
  const bm25Options = protocol.strategies.find((item) => item.id === "bm25")?.parameters ?? {};
  const bm25BuildStarted = performance.now();
  const bm25Index = new Bm25Index(chunks, bm25Options);
  const bm25IndexBuildMs = Math.round(performance.now() - bm25BuildStarted);
  const bm25SearchStarted = performance.now();
  const bm25Rankings = cases.map((item) => bm25Index.search(item.question, protocol.candidateDepth));
  const bm25Ms = Math.round(performance.now() - bm25SearchStarted);
  const rrfParameters = protocol.strategies.find((item) => item.id === "hybrid-rrf")?.parameters ?? {};
  const rrfRankings = timeRankings(() => cases.map((_, index) => reciprocalRankFusion(
    [denseRankings.rankings[index], bm25Rankings[index]],
    { rankConstant: rrfParameters.rankConstant, limit: protocol.candidateDepth },
  )));
  const rankingMap: Record<StrategyId, { rankings: ScoredChunk[][]; scoringMs: number }> = {
    "dense-cosine": denseRankings,
    bm25: { rankings: bm25Rankings, scoringMs: bm25Ms },
    "hybrid-rrf": rrfRankings,
  };
  const results = protocol.strategies.map((strategy) => evaluateStrategy(strategy, rankingMap[strategy.id], cases, protocol));
  const createdAt = new Date().toISOString();
  const artifact = {
    schemaVersion: 1,
    id: protocol.id,
    attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17),
    createdAt,
    hypothesis: protocol.hypothesis,
    parentRunId: run.runId,
    experimentId: run.experimentId,
    split: "validation",
    caseSelection: { total: cases.length, answerable: cases.filter((item) => item.answerability === "answerable").length, unanswerable: cases.filter((item) => item.answerability === "unanswerable").length },
    inputHashes: { protocol: sha256(protocolRaw), config: sha256(configRaw), chunks: sha256(chunksRaw), goldenSet: sha256(goldenRaw), splitManifest: sha256(splitRaw) },
    cache: { documentHits: documents.cache.cacheHits, queryHits: queries.cache.cacheHits, apiInputs: documents.apiInputs + queries.apiInputs, apiRequests: documents.apiRequests + queries.apiRequests },
    timingsMs: { cacheLoad: embeddingMs, bm25IndexBuild: bm25IndexBuildMs },
    controlledVariables: protocol.controlledVariables,
    results,
  };
  const attemptDirectory = path.join(runDirectory, "retrieval-strategy-attempts", protocol.id, artifact.attemptId);
  await fs.mkdir(attemptDirectory, { recursive: true });
  await fs.writeFile(path.join(attemptDirectory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(attemptDirectory, "summary.md"), renderMarkdown(artifact));
  if (options.writeReport) await writeReport(protocol.reportOutput, artifact);
  console.log(`COMPLETED ${protocol.id}/${artifact.attemptId}`);
  for (const result of results) console.log(`${result.strategy}: threshold=${result.selectedThreshold ?? "none"}, Recall@${protocol.topK}=${format(result.selectedMetrics?.recallAtK)}, FPR=${format(result.selectedMetrics?.noAnswerFalsePositiveRate)}`);
}

function evaluateStrategy(strategy: Protocol["strategies"][number], source: { rankings: ScoredChunk[][]; scoringMs: number }, cases: GoldenCase[], protocol: Protocol): StrategyResult {
  const rankingOnlyResult = metricsAtThreshold(source.rankings, cases, protocol.topK, Number.NEGATIVE_INFINITY);
  const rankingOnly = rankingOnlyResult.metrics;
  const thresholdResults = strategy.thresholds.map((threshold) => ({ threshold, ...metricsAtThreshold(source.rankings, cases, protocol.topK, threshold) }));
  const eligible = thresholdResults.filter((item) => item.metrics.noAnswerFalsePositiveRate === protocol.selectionRule.primaryTarget && (item.metrics.recallAtK ?? -1) >= protocol.selectionRule.guardrails.recallAtK && (item.metrics.mrr ?? -1) >= protocol.selectionRule.guardrails.mrr);
  const selected = [...eligible].sort((left, right) => (right.metrics.ndcgAtK ?? -1) - (left.metrics.ndcgAtK ?? -1) || (right.metrics.precisionAtK ?? -1) - (left.metrics.precisionAtK ?? -1) || left.threshold - right.threshold)[0];
  return {
    strategy: strategy.id,
    parameters: strategy.parameters ?? {},
    scoringMs: source.scoringMs,
    rankingOnly,
    rankingOnlyCases: rankingOnlyResult.cases,
    thresholdResults,
    selectedThreshold: selected?.threshold ?? null,
    selectedMetrics: selected?.metrics ?? null,
    decision: selected ? "Selected by the predeclared validation rule." : "No candidate satisfied zero false positives and both quality guardrails.",
  };
}

function metricsAtThreshold(rankings: ScoredChunk[][], cases: GoldenCase[], topK: number, threshold: number) {
  const evaluated = cases.map((testCase, index) => {
    const ranked: RankedChunk[] = rankings[index].filter((chunk) => chunk.score >= threshold).slice(0, topK).map((chunk, rank) => ({ ...chunk, rank: rank + 1 }));
    return evaluateRetrievalCase(testCase, ranked);
  });
  return { metrics: aggregateRetrievalMetrics(evaluated), returnedChunks: evaluated.reduce((total, item) => total + item.retrievedCount, 0), cases: evaluated };
}

function renderMarkdown(artifact: { id: string; attemptId: string; parentRunId: string; split: string; hypothesis: string; caseSelection: { total: number; answerable: number; unanswerable: number }; cache: { documentHits: number; queryHits: number; apiInputs: number; apiRequests: number }; timingsMs: { cacheLoad: number; bm25IndexBuild: number }; controlledVariables: string[]; results: StrategyResult[] }) {
  return `# Retrieval strategy comparison\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Parent run: \`${artifact.parentRunId}\`\n- Split: **${artifact.split}** (${artifact.caseSelection.answerable} answerable + ${artifact.caseSelection.unanswerable} unanswerable)\n- Hypothesis: ${artifact.hypothesis}\n- Cache-only: **${artifact.cache.apiInputs === 0 ? "yes" : "no"}**\n\n## Calibrated comparison\n\n| Strategy | Selected threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR | Query scoring ms | Decision |\n|---|---:|---:|---:|---:|---:|---:|---:|---|\n${artifact.results.map((item) => `| ${item.strategy} | ${item.selectedThreshold ?? "n/a"} | ${format(item.selectedMetrics?.recallAtK)} | ${format(item.selectedMetrics?.precisionAtK)} | ${format(item.selectedMetrics?.mrr)} | ${format(item.selectedMetrics?.ndcgAtK)} | ${format(item.selectedMetrics?.noAnswerFalsePositiveRate)} | ${item.scoringMs} | ${item.decision} |`).join("\n")}\n\nBM25 index construction took ${artifact.timingsMs.bm25IndexBuild} ms and is reported separately from query scoring. Dense embedding generation is excluded because vectors were loaded from the shared cache.\n\n## Ranking-only diagnostic\n\n| Strategy | Recall@4 | Precision@4 | MRR | nDCG@4 |\n|---|---:|---:|---:|---:|\n${artifact.results.map((item) => `| ${item.strategy} | ${format(item.rankingOnly.recallAtK)} | ${format(item.rankingOnly.precisionAtK)} | ${format(item.rankingOnly.mrr)} | ${format(item.rankingOnly.ndcgAtK)} |`).join("\n")}\n\n### Answerable cases missed at ranking stage\n\n${artifact.results.map(renderMissedCases).join("\n")}\n\nRanking-only metrics ignore abstention and expose ordering quality. Calibrated metrics apply a strategy-specific validation threshold; raw score thresholds are not comparable across cosine, BM25, and RRF. No held-out test cases are used for strategy selection.\n\n## Controlled variables\n\n${artifact.controlledVariables.map((item) => `- ${item}`).join("\n")}\n`;
}

function renderMissedCases(result: StrategyResult) {
  const missed = result.rankingOnlyCases.filter((item) => item.answerability === "answerable" && item.recallAtK !== 1).map((item) => item.caseId);
  return `- ${result.strategy}: ${missed.length ? missed.map((id) => `\`${id}\``).join(", ") : "none"}`;
}

async function writeReport(output: string, artifact: Parameters<typeof renderMarkdown>[0]) {
  const base = path.resolve(output);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(`${base}.md`, renderMarkdown(artifact));
  const rows = artifact.results.map((item) => [item.strategy, item.selectedThreshold ?? "", item.selectedMetrics?.recallAtK ?? "", item.selectedMetrics?.precisionAtK ?? "", item.selectedMetrics?.mrr ?? "", item.selectedMetrics?.ndcgAtK ?? "", item.selectedMetrics?.noAnswerFalsePositiveRate ?? "", item.scoringMs, item.decision]);
  await fs.writeFile(`${base}.csv`, [["strategy", "selected_threshold", "recall_at_4", "precision_at_4", "mrr", "ndcg_at_4", "no_answer_fpr", "query_scoring_ms", "decision"], ...rows].map((row) => row.join(",")).join("\n") + "\n");
}

function timeRankings(build: () => ScoredChunk[][]) {
  const started = performance.now();
  const rankings = build();
  return { rankings, scoringMs: Math.round(performance.now() - started) };
}

function compareScores(left: ScoredChunk, right: ScoredChunk) {
  return right.score - left.score || left.id.localeCompare(right.id);
}

function validateProtocol(protocol: Protocol) {
  if (protocol.schemaVersion !== 1 || protocol.split !== "validation") throw new Error("Protocol must use schema v1 and validation split.");
  if (protocol.topK < 1 || protocol.candidateDepth < protocol.topK) throw new Error("candidateDepth must be at least topK.");
  if (new Set(protocol.strategies.map((item) => item.id)).size !== protocol.strategies.length) throw new Error("Duplicate strategies are not allowed.");
  for (const strategy of protocol.strategies) if (!strategy.thresholds.length || new Set(strategy.thresholds).size !== strategy.thresholds.length) throw new Error(`${strategy.id} requires unique thresholds.`);
}

function parseArgs(args: string[]) {
  const value = (name: string, fallback?: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const run = value("--run");
  if (!run) throw new Error("Usage: tsx scripts/evaluate-retrieval-strategies.ts --run <prepared-validation-run> [--write-report]");
  return { run, protocol: value("--protocol", "docs/experiments/common-retrieval-strategies.v1.json")!, writeReport: args.includes("--write-report") };
}

function canonicalJson(value: string) { return JSON.stringify(JSON.parse(value)); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number | null | undefined) { return value === null || value === undefined ? "n/a" : value.toFixed(4); }

main().catch((error) => { console.error(error); process.exit(1); });
