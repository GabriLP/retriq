import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import type { ConfirmatoryBenchmark } from "../src/lib/evaluation/confirmatory-benchmark";
import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, validateGoldenSet, validateGoldenSetSplit, type GoldenCase } from "../src/lib/rag/golden-set";
import { filterChunksByQueryMetadata, type CompatibilityDecision } from "../src/lib/rag/metadata-filter";
import { aggregateRetrievalMetrics, evaluateRetrievalCase, type RankedChunk, type RetrievalCaseResult } from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

type Protocol = {
  schemaVersion: 1;
  id: string;
  status: "preregistered" | "completed";
  testSplit: { dataset: string; manifest?: string; datasetType?: "golden-split" | "confirmatory-locked"; name: "test"; caseCount: number; answerableCount: number; unanswerableCount: number; priorScoredArtifactMatches: number; approvalProvenance: { approvalState: string; independentHumanApproval: boolean; reviewFile?: string } };
  frozenConfiguration: { corpusRun: string; corpusChunks: number; chunking: { targetWords: number; overlapWords: number }; embedding: { provider: "google" | "openai" | "voyage"; model: string; outputDimensionality: number; documentTask: string; queryTask: string }; retrieval: { strategy: "dense-cosine"; metadataFiltering: true; minScore: number; topK: number; reranker: null; agenticLoop: false } };
  frozenReplicationChecks: { recallAtKMinimum: number; mrrMinimum: number; ndcgAtKMinimum: number; noAnswerFalsePositiveRateMaximum: number; providerErrorsMaximum: number };
  costCeilingUsd: number;
  integrity: Record<string, string>;
  plannedOutputs: string[];
};

type Interval = { numerator: number; denominator: number; rate: number; lower: number; upper: number };
type FinalRetrievalArtifact = {
  id: string;
  createdAt: string;
  metrics: ReturnType<typeof aggregateRetrievalMetrics>;
  intervals: {
    fullCanonicalCoverage: Interval;
    anyCanonicalHit: Interval;
    falsePositive: Interval;
  };
  passedAllChecks: boolean;
  cases: RetrievalCaseResult[];
  cache: { apiRequests: number };
  cost: { estimatedUsd: number };
  provenance: {
    gitCommit: string | null;
    benchmarkApprovalState: string;
  };
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const protocolPath = path.resolve(options.protocol);
  const protocolRaw = await fs.readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw) as Protocol;
  validateProtocol(protocol);
  const inputs = await loadAndValidateInputs(protocol, protocolPath);

  if (options.plan) {
    console.log(`VALID PLAN ${protocol.id}: ${inputs.cases.length} locked test cases (${inputs.answerable.length} answerable, ${inputs.unanswerable.length} unanswerable).`);
    console.log(`Frozen retrieval: ${protocol.frozenConfiguration.retrieval.strategy}, metadata filter, threshold=${protocol.frozenConfiguration.retrieval.minScore}, topK=${protocol.frozenConfiguration.retrieval.topK}, no reranker, no agentic loop.`);
    console.log(`Approval provenance: ${protocol.testSplit.approvalProvenance.approvalState}; independent=${protocol.testSplit.approvalProvenance.independentHumanApproval}. No retrieval metrics were computed.`);
    return;
  }
  if (!options.allowProviderRequests || !options.writeReport) throw new Error("Execution requires both --allow-provider-requests and --write-report.");
  for (const output of protocol.plannedOutputs) if (await exists(path.resolve(output))) throw new Error(`Refusing to rerun: output already exists at ${output}.`);
  if (runCommand("git", ["diff", "--quiet"]) === null) throw new Error("Tracked working tree changes must be committed before the locked test.");

  const started = performance.now();
  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const embedding = protocol.frozenConfiguration.embedding;
  const common = { provider: embedding.provider, model: embedding.model, outputDimensionality: embedding.outputDimensionality, batchSize: inputs.config.embedding.batchSize, priceUsdPerMillionTokens: inputs.config.embedding.pricing?.usdPerMillionInputTokens };
  const documents = await embedTextsWithCache(inputs.chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), { ...common, taskType: embedding.documentTask as "RETRIEVAL_DOCUMENT", titles: inputs.chunks.map((chunk) => chunk.title), allowProviderRequests: false });
  const queries = await embedTextsWithCache(inputs.cases.map((item) => item.question), { ...common, taskType: embedding.queryTask as "QUESTION_ANSWERING", allowProviderRequests: true });

  const decisions: Array<CompatibilityDecision & { caseId: string; compatibleChunks: number }> = [];
  const results: RetrievalCaseResult[] = inputs.cases.map((testCase, caseIndex) => {
    const compatibility = filterChunksByQueryMetadata(testCase.question, inputs.chunks);
    decisions.push({ caseId: testCase.id, ...compatibility.decision, compatibleChunks: compatibility.chunks.length });
    const indexById = new Map(inputs.chunks.map((chunk, index) => [chunk.id, index]));
    const ranked: RankedChunk[] = compatibility.decision.status === "compatible"
      ? compatibility.chunks.map((chunk) => ({ ...chunk, score: cosineSimilarity(queries.vectors[caseIndex], documents.vectors[indexById.get(chunk.id)!]) }))
          .filter((chunk) => chunk.score >= protocol.frozenConfiguration.retrieval.minScore)
          .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
          .slice(0, protocol.frozenConfiguration.retrieval.topK)
          .map((chunk, rank) => ({ ...chunk, rank: rank + 1 }))
      : [];
    return evaluateRetrievalCase(testCase, ranked);
  });
  const metrics = aggregateRetrievalMetrics(results);
  const answerableResults = results.filter((item) => item.answerability === "answerable");
  const negativeResults = results.filter((item) => item.answerability === "unanswerable");
  const intervals = {
    fullCanonicalCoverage: wilson(answerableResults.filter((item) => item.recallAtK === 1).length, answerableResults.length),
    anyCanonicalHit: wilson(answerableResults.filter((item) => item.relevantRetrieved > 0).length, answerableResults.length),
    falsePositive: wilson(negativeResults.filter((item) => item.falsePositive).length, negativeResults.length),
  };
  const estimatedCostUsd = (documents.cache.estimatedApiCostUsd ?? 0) + (queries.cache.estimatedApiCostUsd ?? 0);
  const checks = {
    recallAtK: (metrics.recallAtK ?? -1) >= protocol.frozenReplicationChecks.recallAtKMinimum,
    mrr: (metrics.mrr ?? -1) >= protocol.frozenReplicationChecks.mrrMinimum,
    ndcgAtK: (metrics.ndcgAtK ?? -1) >= protocol.frozenReplicationChecks.ndcgAtKMinimum,
    falsePositiveRate: (metrics.noAnswerFalsePositiveRate ?? 1) <= protocol.frozenReplicationChecks.noAnswerFalsePositiveRateMaximum,
    providerErrors: true,
    costCeiling: estimatedCostUsd <= protocol.costCeilingUsd,
  };
  const createdAt = new Date().toISOString();
  const artifact = {
    schemaVersion: 1, id: protocol.id, createdAt, split: "test", executionNumber: 1,
    configuration: protocol.frozenConfiguration, metrics, intervals, checks, passedAllChecks: Object.values(checks).every(Boolean),
    cases: results, compatibilityDecisions: decisions,
    cache: { documentHits: documents.cache.cacheHits, documentMisses: documents.cache.cacheMisses, queryHits: queries.cache.cacheHits, queryMisses: queries.cache.cacheMisses, apiInputs: documents.apiInputs + queries.apiInputs, apiRequests: documents.apiRequests + queries.apiRequests, cacheWrites: documents.cacheWrites + queries.cacheWrites },
    cost: { estimatedUsd: estimatedCostUsd, ceilingUsd: protocol.costCeilingUsd, priceUsdPerMillionInputTokens: inputs.config.embedding.pricing?.usdPerMillionInputTokens ?? null },
    timingMs: Math.round(performance.now() - started),
    provenance: { gitCommit: runCommand("git", ["rev-parse", "HEAD"]), protocolSha256: sha256(protocolRaw), runnerSha256: sha256(await fs.readFile(new URL(import.meta.url), "utf8")), benchmarkApprovalState: protocol.testSplit.approvalProvenance.approvalState, independentlyHumanApproved: protocol.testSplit.approvalProvenance.independentHumanApproval, priorScoredArtifactMatches: protocol.testSplit.priorScoredArtifactMatches },
    interpretation: "The locked result is retained regardless of pass/fail. It verifies retrieval only and does not authorize post-result tuning."
  };
  await writeOutputs(protocol, artifact);
  console.log(`COMPLETED ${protocol.id}: Recall@4=${format(metrics.recallAtK)}, MRR=${format(metrics.mrr)}, nDCG@4=${format(metrics.ndcgAtK)}, FPR=${format(metrics.noAnswerFalsePositiveRate)}, passed=${artifact.passedAllChecks}.`);
  console.log(`Provider requests=${artifact.cache.apiRequests}, estimated cost=$${estimatedCostUsd.toFixed(6)}.`);
}

async function loadAndValidateInputs(protocol: Protocol, protocolPath: string) {
  const runDirectory = path.resolve(protocol.frozenConfiguration.corpusRun);
  const [runRaw, configRaw, chunksRaw, datasetRaw, splitRaw] = await Promise.all([
    fs.readFile(path.join(runDirectory, "run.json"), "utf8"),
    fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8"),
    fs.readFile(path.join(runDirectory, "chunks.json"), "utf8"),
    fs.readFile(path.resolve(protocol.testSplit.dataset), "utf8"),
    protocol.testSplit.manifest ? fs.readFile(path.resolve(protocol.testSplit.manifest), "utf8") : Promise.resolve(null),
  ]);
  const hashInputs: Record<string, [string, string]> = {
    [protocol.testSplit.datasetType === "confirmatory-locked" ? "benchmarkSha256" : "goldenSetSha256"]: [datasetRaw, protocol.testSplit.dataset],
    preparedConfigSnapshotSha256: [configRaw, "prepared config"],
    chunksSha256: [chunksRaw, "prepared chunks"],
  };
  if (splitRaw && protocol.testSplit.manifest) hashInputs.splitManifestSha256 = [splitRaw, protocol.testSplit.manifest];
  if (protocol.testSplit.approvalProvenance.reviewFile) {
    hashInputs.reviewCsvSha256 = [
      await fs.readFile(path.resolve(protocol.testSplit.approvalProvenance.reviewFile), "utf8"),
      protocol.testSplit.approvalProvenance.reviewFile,
    ];
  }
  for (const [key, [raw, label]] of Object.entries(hashInputs)) if (sha256(raw) !== protocol.integrity[key]) throw new Error(`Integrity mismatch for ${label}.`);
  const fileHashes: Record<string, string> = {
    baseConfigSha256: "docs/experiments/baseline-gemini-300-v4-validation.json", selectionProtocolSha256: "docs/experiments/baseline-gemini-300-v4-metadata-filter.v2.json", selectionReportMarkdownSha256: "docs/experiment-results/baseline-gemini-300-v4-metadata-filter-v2-validation.md", selectionReportCsvSha256: "docs/experiment-results/baseline-gemini-300-v4-metadata-filter-v2-validation.csv", metadataFilterSha256: "src/lib/rag/metadata-filter.ts", retrievalMetricsSha256: "src/lib/rag/retrieval-metrics.ts", vectorStoreSha256: "src/lib/rag/vector-store.ts"
  };
  for (const [key, file] of Object.entries(fileHashes)) if (sha256(await fs.readFile(path.resolve(file), "utf8")) !== protocol.integrity[key]) throw new Error(`Integrity mismatch for ${file}.`);
  const run = JSON.parse(runRaw) as ExperimentRun;
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  let cases: GoldenCase[];
  if (protocol.testSplit.datasetType === "confirmatory-locked") {
    const benchmark = JSON.parse(datasetRaw) as ConfirmatoryBenchmark;
    if (benchmark.status !== "confirmed-locked" || !benchmark.testLocked || benchmark.version !== "1.0.0" || !benchmark.confirmation) {
      throw new Error("Confirmatory benchmark is not confirmed and locked.");
    }
    cases = benchmark.cases;
  } else {
    if (!protocol.testSplit.manifest || !splitRaw) throw new Error("Golden-set execution requires a split manifest.");
    const golden = await loadGoldenSet(protocol.testSplit.dataset);
    const split = await loadGoldenSetSplit(protocol.testSplit.manifest);
    const validation = await validateGoldenSet(golden);
    const splitValidation = validateGoldenSetSplit(golden, split);
    if (validation.errors.length || splitValidation.errors.length) throw new Error([...validation.errors, ...splitValidation.errors].join("\n"));
    if (!split.testLocked) throw new Error("Golden-set test split is not locked.");
    cases = selectGoldenSplit(golden, split, "test");
  }
  if (run.status !== "prepared" || chunks.length !== protocol.frozenConfiguration.corpusChunks) throw new Error("Frozen run or chunk-count validation failed.");
  const answerable = cases.filter((item) => item.answerability === "answerable");
  const unanswerable = cases.filter((item) => item.answerability === "unanswerable");
  if (cases.length !== protocol.testSplit.caseCount || answerable.length !== protocol.testSplit.answerableCount || unanswerable.length !== protocol.testSplit.unanswerableCount) throw new Error("Test split cardinality differs from the preregistration.");
  if (cases.some((item) => item.status !== "human-approved" || item.approval?.state !== protocol.testSplit.approvalProvenance.approvalState)) throw new Error("Benchmark approval provenance differs from the preregistration.");
  void protocolPath;
  return { config, chunks, cases, answerable, unanswerable };
}

async function writeOutputs(protocol: Protocol, artifact: FinalRetrievalArtifact) {
  const [jsonPath, mdPath, csvPath] = protocol.plannedOutputs.map((item) => path.resolve(item));
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  await fs.writeFile(mdPath, renderMarkdown(artifact), { flag: "wx" });
  const rows = artifact.cases.map((item: RetrievalCaseResult) => [item.caseId, item.answerability, item.retrievedCount, item.relevantRetrieved, item.recallAtK ?? "", item.precisionAtK ?? "", item.reciprocalRank ?? "", item.ndcgAtK ?? "", item.falsePositive ?? "", item.rankedChunks.map((chunk) => chunk.chunkId).join(";")]);
  await fs.writeFile(csvPath, [["case_id", "answerability", "retrieved_count", "relevant_retrieved", "recall_at_4", "precision_at_4", "reciprocal_rank", "ndcg_at_4", "false_positive", "ranked_chunk_ids"], ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n", { flag: "wx" });
}

function renderMarkdown(a: FinalRetrievalArtifact) {
  return `# Final locked retrieval test\n\n- Protocol: \`${a.id}\`\n- Executed: ${a.createdAt}\n- Commit: \`${a.provenance.gitCommit}\`\n- Split: **test (single execution)**\n- Approval provenance: **${a.provenance.benchmarkApprovalState}; thesis-author confirmed**\n- Configuration: 300-word chunks, 80-word overlap, Gemini Embedding 2 (1,024 dimensions), metadata-aware dense cosine, threshold 0.68, top-k 4, no reranker, no agentic loop\n\n| Metric | Result | Frozen check |\n|---|---:|---:|\n| Recall@4 | ${format(a.metrics.recallAtK)} | >= 0.9167 |\n| Precision@4 | ${format(a.metrics.precisionAtK)} | descriptive |\n| MRR | ${format(a.metrics.mrr)} | >= 0.8500 |\n| nDCG@4 | ${format(a.metrics.ndcgAtK)} | >= 0.8500 |\n| Unanswerable FPR | ${format(a.metrics.noAnswerFalsePositiveRate)} | <= 0.0833 |\n\nAll frozen checks: **${a.passedAllChecks ? "PASS" : "FAIL"}**. Estimated embedding cost: **$${a.cost.estimatedUsd.toFixed(6)}**; provider requests: **${a.cache.apiRequests}**.\n\n## Binomial uncertainty (Wilson 95%)\n\n| Proportion | Count | Rate | 95% interval |\n|---|---:|---:|---:|\n| Full canonical coverage | ${ratio(a.intervals.fullCanonicalCoverage)} | ${format(a.intervals.fullCanonicalCoverage.rate)} | ${interval(a.intervals.fullCanonicalCoverage)} |\n| Any canonical hit | ${ratio(a.intervals.anyCanonicalHit)} | ${format(a.intervals.anyCanonicalHit.rate)} | ${interval(a.intervals.anyCanonicalHit)} |\n| False positives | ${ratio(a.intervals.falsePositive)} | ${format(a.intervals.falsePositive.rate)} | ${interval(a.intervals.falsePositive)} |\n\nThis result is retained regardless of outcome and was not used for tuning. It verifies retrieval only. The uncertainty intervals and single-reviewer provenance must accompany thesis claims.\n`;
}

export function wilson(successes: number, total: number, z = 1.959963984540054): Interval {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) throw new Error("Invalid Wilson interval inputs.");
  const rate = successes / total;
  const denominator = 1 + z * z / total;
  const center = (rate + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + z * z / (4 * total)) / total) / denominator;
  return { numerator: successes, denominator: total, rate, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function validateProtocol(p: Protocol) { if (p.schemaVersion !== 1 || !["baseline-final-test-v1", "confirmatory-final-test-v2"].includes(p.id) || p.status !== "preregistered" || p.testSplit.name !== "test") throw new Error("The final-test protocol is not executable."); if (p.id === "confirmatory-final-test-v2" && p.testSplit.datasetType !== "confirmatory-locked") throw new Error("Confirmatory v2 requires a locked confirmatory benchmark."); if (p.frozenConfiguration.retrieval.minScore !== 0.68 || p.frozenConfiguration.retrieval.topK !== 4 || p.frozenConfiguration.retrieval.reranker !== null || p.frozenConfiguration.retrieval.agenticLoop !== false) throw new Error("Frozen retrieval controls changed."); }
function parseArgs(args: string[]) { const index = args.indexOf("--protocol"); return { protocol: index >= 0 ? args[index + 1] : "docs/experiments/baseline-final-test.v1.json", plan: args.includes("--plan"), allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report") }; }
function wilsonFormat(v: number) { return v.toFixed(4); }
function interval(v: Interval) { return `[${wilsonFormat(v.lower)}, ${wilsonFormat(v.upper)}]`; }
function ratio(v: Interval) { return `${v.numerator}/${v.denominator}`; }
function format(value: number | null | undefined) { return value === null || value === undefined ? "n/a" : value.toFixed(4); }
function csv(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }
function runCommand(command: string, args: string[]) { const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true }); return result.status === 0 ? result.stdout.trim() : null; }

main().catch((error) => { console.error(error); process.exit(1); });
