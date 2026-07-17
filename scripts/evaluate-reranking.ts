import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, validateGoldenSet, validateGoldenSetSplit, type GoldenCase } from "../src/lib/rag/golden-set";
import { filterChunksByQueryMetadata } from "../src/lib/rag/metadata-filter";
import { aggregateRetrievalMetrics, evaluateRetrievalCase, matchesEvidence, type RankedChunk } from "../src/lib/rag/retrieval-metrics";
import { estimateRerankerTokens, rerankDocuments } from "../src/lib/rag/rerankers";
import type { DocumentationChunk } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

type Metrics = ReturnType<typeof aggregateRetrievalMetrics>;
type Variant = { id: string; provider: "voyage" | null; model: string | null; priceUsdPerMillionTokens: number };
type Protocol = {
  schemaVersion: 1;
  id: string;
  title: string;
  hypothesis: string;
  baseExperimentConfig: string;
  split: "validation";
  variants: Variant[];
  candidateDepth: number;
  finalTopK: number;
  denseEligibilityThreshold: number;
  selectionRule: { primary: "ndcgAtK"; minimumAbsoluteLift: number; guardrails: { noAnswerFalsePositiveRateMaximum: number; recallAtKMinimum: number; mrrMinimum: number }; tieBreakers: string[] };
  controlledVariables: string[];
  changedVariable: string;
  pricing: { observedAt: string; sourceUrl: string; freeTierNotSubtracted: boolean };
  reportOutput: string;
};
type ScoredChunk = DocumentationChunk & { score: number };
type VariantResult = {
  variant: string;
  model: string | null;
  metrics: Metrics;
  ndcgLift: number;
  eligible: boolean;
  decision: string;
  cacheHits: number;
  apiRequests: number;
  processedTokens: number;
  estimatedCostUsd: number;
  latencyMs: { total: number; mean: number; median: number; p95: number };
  cases: ReturnType<typeof evaluateRetrievalCase>[];
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
  const baseConfigRaw = await fs.readFile(path.resolve(path.dirname(protocolPath), protocol.baseExperimentConfig), "utf8");
  if (canonicalJson(baseConfigRaw) !== canonicalJson(configRaw)) throw new Error("Prepared run does not match the reranking protocol base configuration.");
  if (run.status !== "prepared" || config.evaluation.split !== "validation") throw new Error("Reranker selection requires a prepared validation run.");
  if (!config.evaluation.goldenSet || !config.evaluation.splitManifest) throw new Error("Golden set and split manifest are required.");

  const goldenRaw = await fs.readFile(path.resolve(config.evaluation.goldenSet), "utf8");
  const splitRaw = await fs.readFile(path.resolve(config.evaluation.splitManifest), "utf8");
  const golden = await loadGoldenSet(config.evaluation.goldenSet);
  const split = await loadGoldenSetSplit(config.evaluation.splitManifest);
  const validation = await validateGoldenSet(golden);
  const splitValidation = validateGoldenSetSplit(golden, split);
  if (validation.errors.length || splitValidation.errors.length) throw new Error([...validation.errors, ...splitValidation.errors].join("\n"));
  const statuses = new Set(config.evaluation.caseStatuses ?? ["human-approved"]);
  const cases = selectGoldenSplit(golden, split, "validation")
    .filter((item) => statuses.has(item.status as "source-verified" | "human-approved"))
    .filter((item) => item.answerability === "unanswerable" || item.evidence.some((evidence) => chunks.some((chunk) => matchesEvidence(chunk, evidence))));

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const [documents, queries] = await Promise.all([
    embedTextsWithCache(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), { provider: "google", model: config.embedding.model, taskType: config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT", outputDimensionality: config.embedding.outputDimensionality, titles: chunks.map((chunk) => chunk.title), batchSize: config.embedding.batchSize, allowProviderRequests: false }),
    embedTextsWithCache(cases.map((item) => item.question), { provider: "google", model: config.embedding.model, taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING", outputDimensionality: config.embedding.outputDimensionality, batchSize: config.embedding.batchSize, allowProviderRequests: false }),
  ]);
  const denseRankings = cases.map((_, caseIndex) => chunks
    .map((chunk, chunkIndex) => ({ ...chunk, score: cosineSimilarity(queries.vectors[caseIndex], documents.vectors[chunkIndex]) }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)));
  const metadataRankings = cases.map((item, index) => {
    const compatibility = filterChunksByQueryMetadata(item.question, chunks);
    if (compatibility.decision.status !== "compatible") return [];
    const ids = new Set(compatibility.chunks.map((chunk) => chunk.id));
    return denseRankings[index].filter((chunk) => ids.has(chunk.id));
  });
  const candidatePools = metadataRankings.map((ranking) => ranking[0]?.score >= protocol.denseEligibilityThreshold ? ranking.slice(0, protocol.candidateDepth) : []);
  const candidateDiagnostics = evaluateCandidateDepth(cases, candidatePools, protocol.candidateDepth);

  if (options.estimateOnly) {
    const estimates = protocol.variants.filter((variant) => variant.model).map((variant) => estimateVariant(variant, cases, candidatePools));
    console.log(JSON.stringify({ candidateDiagnostics, estimates }, null, 2));
    return;
  }

  const baseline = evaluateBaseline(protocol.variants[0], cases, metadataRankings, protocol);
  const results: VariantResult[] = [baseline];
  for (const variant of protocol.variants.slice(1)) results.push(await evaluateReranker(variant, cases, candidatePools, protocol, baseline, options.allowProviderRequests));
  const selected = selectVariant(results);
  const createdAt = new Date().toISOString();
  const provenancePaths = ["src", "scripts", "package.json", "package-lock.json", "docs/corpus", "docs/experiments", "docs/evaluation"];
  const gitStatus = runCommand("git", ["status", "--porcelain", "--", ...provenancePaths]);
  const gitDiff = runCommand("git", ["diff", "--binary", "--", ...provenancePaths]);
  const artifact = {
    schemaVersion: 1,
    id: protocol.id,
    attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17),
    createdAt,
    parentRunId: run.runId,
    experimentId: run.experimentId,
    hypothesis: protocol.hypothesis,
    split: protocol.split,
    inputHashes: { protocol: sha256(protocolRaw), config: sha256(configRaw), chunks: sha256(chunksRaw), goldenSet: sha256(goldenRaw), splitManifest: sha256(splitRaw) },
    code: { gitCommit: runCommand("git", ["rev-parse", "HEAD"]) || "unknown", dirty: Boolean(gitStatus), gitDiffHash: sha256(gitDiff) },
    controls: { candidateDepth: protocol.candidateDepth, finalTopK: protocol.finalTopK, denseEligibilityThreshold: protocol.denseEligibilityThreshold, variables: protocol.controlledVariables },
    embeddingCache: { documentHits: documents.cache.cacheHits, queryHits: queries.cache.cacheHits, apiInputs: documents.apiInputs + queries.apiInputs },
    candidateDiagnostics,
    pricing: protocol.pricing,
    results,
    selectedVariant: selected?.variant ?? "no-reranker",
    decision: selected ? `Select ${selected.variant}; it satisfies the pre-registered lift and guardrails.` : "Retain no-reranker; no specialized reranker satisfied the pre-registered lift and guardrails.",
    testSplitTouched: false,
  };
  const directory = path.join(runDirectory, "reranking-attempts", protocol.id, artifact.attemptId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(directory, "summary.md"), renderMarkdown(artifact));
  if (options.writeReport) await writeReport(protocol.reportOutput, artifact);
  console.log(`COMPLETED ${protocol.id}/${artifact.attemptId}: selected=${artifact.selectedVariant}`);
}

function evaluateBaseline(variant: Variant, cases: GoldenCase[], rankings: ScoredChunk[][], protocol: Protocol): VariantResult {
  const evaluated = cases.map((item, index) => evaluateRetrievalCase(item, rankings[index].filter((chunk) => chunk.score >= protocol.denseEligibilityThreshold).slice(0, protocol.finalTopK).map((chunk, rank) => ({ ...chunk, rank: rank + 1 }))));
  return { variant: variant.id, model: null, metrics: aggregateRetrievalMetrics(evaluated), ndcgLift: 0, eligible: true, decision: "Control.", cacheHits: 0, apiRequests: 0, processedTokens: 0, estimatedCostUsd: 0, latencyMs: { total: 0, mean: 0, median: 0, p95: 0 }, cases: evaluated };
}

async function evaluateReranker(variant: Variant, cases: GoldenCase[], pools: ScoredChunk[][], protocol: Protocol, baseline: VariantResult, allowProviderRequests: boolean): Promise<VariantResult> {
  if (variant.provider !== "voyage" || !variant.model) throw new Error(`Unsupported reranker variant ${variant.id}.`);
  let cacheHits = 0; let apiRequests = 0; let processedTokens = 0; let estimatedCostUsd = 0;
  const latencies: number[] = [];
  const evaluated = [];
  for (let index = 0; index < cases.length; index += 1) {
    const pool = pools[index];
    if (!pool.length) { evaluated.push(evaluateRetrievalCase(cases[index], [])); continue; }
    const started = performance.now();
    const response = await rerankDocuments(cases[index].question, pool.map(formatRerankerDocument), { model: variant.model, topK: pool.length, priceUsdPerMillionTokens: variant.priceUsdPerMillionTokens, allowProviderRequests });
    latencies.push(performance.now() - started);
    cacheHits += response.cacheHit ? 1 : 0; apiRequests += response.apiRequests; processedTokens += response.processedTokens; estimatedCostUsd += response.estimatedCostUsd;
    const ranked: RankedChunk[] = response.results.slice(0, protocol.finalTopK).map((result, rank) => ({ ...pool[result.index], rank: rank + 1, score: Number(result.relevanceScore.toFixed(6)) }));
    evaluated.push(evaluateRetrievalCase(cases[index], ranked));
  }
  const metrics = aggregateRetrievalMetrics(evaluated);
  const ndcgLift = (metrics.ndcgAtK ?? 0) - (baseline.metrics.ndcgAtK ?? 0);
  const eligible = ndcgLift >= protocol.selectionRule.minimumAbsoluteLift && (metrics.noAnswerFalsePositiveRate ?? 1) <= protocol.selectionRule.guardrails.noAnswerFalsePositiveRateMaximum && (metrics.recallAtK ?? 0) >= protocol.selectionRule.guardrails.recallAtKMinimum && (metrics.mrr ?? 0) >= protocol.selectionRule.guardrails.mrrMinimum;
  return { variant: variant.id, model: variant.model, metrics, ndcgLift, eligible, decision: eligible ? "Eligible under the pre-registered rule." : failureReason(metrics, ndcgLift, protocol), cacheHits, apiRequests, processedTokens, estimatedCostUsd, latencyMs: latencySummary(latencies), cases: evaluated };
}

function selectVariant(results: VariantResult[]) {
  return results.filter((item) => item.variant !== "no-reranker" && item.eligible).sort((left, right) => (right.metrics.ndcgAtK ?? 0) - (left.metrics.ndcgAtK ?? 0) || left.estimatedCostUsd - right.estimatedCostUsd || left.latencyMs.median - right.latencyMs.median)[0] ?? null;
}

function evaluateCandidateDepth(cases: GoldenCase[], pools: ScoredChunk[][], depth: number) {
  const evaluated = cases.map((item, index) => evaluateRetrievalCase(item, pools[index].map((chunk, rank) => ({ ...chunk, rank: rank + 1 }))));
  const metrics = aggregateRetrievalMetrics(evaluated);
  return { depth, eligibleQueries: pools.filter((pool) => pool.length).length, recallAtDepth: metrics.recallAtK, answerableCasesWithoutEvidence: evaluated.filter((item) => item.answerability === "answerable" && item.relevantRetrieved === 0).map((item) => item.caseId) };
}

function estimateVariant(variant: Variant, cases: GoldenCase[], pools: ScoredChunk[][]) {
  const tokens = pools.reduce((total, pool, index) => total + (pool.length ? estimateRerankerTokens(cases[index].question, pool.map(formatRerankerDocument)) : 0), 0);
  return { variant: variant.id, requests: pools.filter((pool) => pool.length).length, estimatedTokens: tokens, listPriceCostUsd: tokens / 1_000_000 * variant.priceUsdPerMillionTokens };
}

function formatRerankerDocument(chunk: DocumentationChunk) { return `${chunk.title}\n${chunk.section}\n${chunk.content}`; }
function failureReason(metrics: Metrics, lift: number, protocol: Protocol) { const reasons = []; if (lift < protocol.selectionRule.minimumAbsoluteLift) reasons.push(`nDCG lift ${lift.toFixed(4)} < ${protocol.selectionRule.minimumAbsoluteLift.toFixed(4)}`); if ((metrics.recallAtK ?? 0) < protocol.selectionRule.guardrails.recallAtKMinimum) reasons.push(`Recall@4 ${(metrics.recallAtK ?? 0).toFixed(4)} below guardrail`); if ((metrics.mrr ?? 0) < protocol.selectionRule.guardrails.mrrMinimum) reasons.push(`MRR ${(metrics.mrr ?? 0).toFixed(4)} below guardrail`); if ((metrics.noAnswerFalsePositiveRate ?? 1) > protocol.selectionRule.guardrails.noAnswerFalsePositiveRateMaximum) reasons.push("no-answer FPR above zero"); return reasons.join("; "); }
function latencySummary(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const total = values.reduce((sum, value) => sum + value, 0); return { total: Math.round(total), mean: round(total / Math.max(values.length, 1)), median: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)) }; }
function percentile(values: number[], value: number) { if (!values.length) return 0; return values[Math.min(values.length - 1, Math.ceil(values.length * value) - 1)]; }
function round(value: number) { return Number(value.toFixed(2)); }

function renderMarkdown(artifact: { id: string; attemptId: string; hypothesis: string; controls: { candidateDepth: number; finalTopK: number; denseEligibilityThreshold: number }; candidateDiagnostics: { recallAtDepth: number | null; eligibleQueries: number; answerableCasesWithoutEvidence: string[] }; results: VariantResult[]; selectedVariant: string; decision: string; testSplitTouched: boolean }) {
  return `# Specialized reranker comparison\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Split: **validation only**\n- Hypothesis: ${artifact.hypothesis}\n- Candidate depth: ${artifact.controls.candidateDepth}; final topK: ${artifact.controls.finalTopK}; dense abstention threshold: ${artifact.controls.denseEligibilityThreshold}\n- Candidate Recall@${artifact.controls.candidateDepth}: ${format(artifact.candidateDiagnostics.recallAtDepth)}; eligible queries: ${artifact.candidateDiagnostics.eligibleQueries}\n- Selected variant: **${artifact.selectedVariant}**\n\n| Variant | Recall@4 | Precision@4 | MRR | nDCG@4 | nDCG lift | FPR | API calls | Tokens | Est. USD | Median ms | Eligible |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${artifact.results.map((item) => `| ${item.variant} | ${format(item.metrics.recallAtK)} | ${format(item.metrics.precisionAtK)} | ${format(item.metrics.mrr)} | ${format(item.metrics.ndcgAtK)} | ${item.ndcgLift.toFixed(4)} | ${format(item.metrics.noAnswerFalsePositiveRate)} | ${item.apiRequests} | ${item.processedTokens} | ${item.estimatedCostUsd.toFixed(6)} | ${item.latencyMs.median.toFixed(2)} | ${item.eligible ? "yes" : "no"} |`).join("\n")}\n\n## Decision\n\n${artifact.decision}\n\nAnswerable cases whose canonical evidence is absent from the candidate pool: ${artifact.candidateDiagnostics.answerableCasesWithoutEvidence.length ? artifact.candidateDiagnostics.answerableCasesWithoutEvidence.map((item) => `\`${item}\``).join(", ") : "none"}. Costs use list price and do not subtract free-tier credits. Latency includes local cache reads when present and therefore must be interpreted alongside cache/API counts. The locked test split was touched: **${artifact.testSplitTouched ? "yes" : "no"}**.\n`;
}

async function writeReport(output: string, artifact: Parameters<typeof renderMarkdown>[0]) { const base = path.resolve(output); await fs.mkdir(path.dirname(base), { recursive: true }); await fs.writeFile(`${base}.md`, renderMarkdown(artifact)); const rows = artifact.results.map((item) => [item.variant, item.metrics.recallAtK ?? "", item.metrics.precisionAtK ?? "", item.metrics.mrr ?? "", item.metrics.ndcgAtK ?? "", item.ndcgLift, item.metrics.noAnswerFalsePositiveRate ?? "", item.apiRequests, item.processedTokens, item.estimatedCostUsd, item.latencyMs.median, item.eligible, item.decision]); await fs.writeFile(`${base}.csv`, [["variant", "recall_at_4", "precision_at_4", "mrr", "ndcg_at_4", "ndcg_lift", "no_answer_fpr", "api_requests", "processed_tokens", "estimated_cost_usd", "median_latency_ms", "eligible", "decision"], ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"); }
function validateProtocol(protocol: Protocol) { if (protocol.schemaVersion !== 1 || protocol.split !== "validation") throw new Error("Reranking protocol must use schema v1 and validation."); if (protocol.variants[0]?.id !== "no-reranker") throw new Error("The first reranking variant must be the control."); if (protocol.candidateDepth < protocol.finalTopK) throw new Error("Candidate depth must be at least finalTopK."); }
function parseArgs(args: string[]) { const value = (name: string, fallback?: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }; const run = value("--run"); if (!run) throw new Error("Usage: tsx scripts/evaluate-reranking.ts --run <prepared-run> [--estimate-only|--allow-provider-requests] [--write-report]"); return { run, protocol: value("--protocol", "docs/experiments/reranking-v1.json")!, estimateOnly: args.includes("--estimate-only"), allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report") }; }
function canonicalJson(value: string) { return JSON.stringify(JSON.parse(value)); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number | null | undefined) { return value === null || value === undefined ? "n/a" : value.toFixed(4); }
function csvCell(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function runCommand(command: string, args: string[]) { const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true }); return result.status === 0 ? result.stdout.trim() : ""; }

main().catch((error) => { console.error(error); process.exit(1); });
