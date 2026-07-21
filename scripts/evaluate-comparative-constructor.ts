import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import { buildComparativeSubqueries } from "../src/lib/rag/comparative-query";
import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import type { DocumentationChunk } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

type VariantId = "manual-frozen" | "automatic-focus-original" | "automatic-topic-template";
type EvidenceTarget = { sourceId: string; acceptedChunkIds: string[] };
type PositiveCase = { id: string; question: string; expectedLanguages: string[]; evidenceByLanguage: Record<string, EvidenceTarget> };
type NegativeCase = { id: string; question: string; expectedLanguages: string[] };
type Benchmark<T> = { schemaVersion: 1; parentRun: string; split: "validation"; testSplitTouched: false; cases: T[] };
type ManualReference = { schemaVersion: 1; split: "validation"; testSplitTouched: false; cases: Array<{ caseId: string; subqueries: Record<string, string> }> };
type Protocol = {
  schemaVersion: 1; id: string; status: "preregistered" | "completed"; split: "validation"; positiveBenchmark: string; negativeBenchmark: string; manualReference: string; parentRun: string; hypothesis: string;
  variants: Array<{ id: VariantId; description: string }>;
  selectionRule: { automaticEligibility: { noAnswerFalsePositiveRate: number; positiveGateRejections: number; minimumBothLanguageCoverageAt4: number; minimumBothEvidenceSideCoverageAt4: number; minimumMeanEvidenceSideRecallAt4: number; minimumMacroEvidenceSideMrr: number; requiredParseSuccessRateForTopicTemplate: number }; failurePolicy: string };
  reportOutput: string;
};
type ScoredChunk = DocumentationChunk & { score: number };
type CompactChunk = ReturnType<typeof compactChunk>;
type VariantResult = {
  variant: VariantId;
  construction: { parseSuccessRate: number; fallbackCount: number; queryCharacters: number };
  metrics: { bothLanguageCoverageAt4: number; meanLanguageSideCoverageAt4: number; bothEvidenceSideCoverageAt4: number; meanEvidenceSideRecallAt4: number; macroEvidenceSideMrr: number; noAnswerFalsePositiveRate: number; positiveGateRejections: number; negativeGateRejections: number; returnedChunks: number };
  positiveCases: Array<{ caseId: string; representedLanguages: string[]; evidenceLanguages: string[]; gatePassed: boolean; retrieved: CompactChunk[] }>;
  negativeCases: Array<{ caseId: string; falsePositive: boolean; gatePassed: boolean; retrieved: CompactChunk[] }>;
};
type Artifact = {
  schemaVersion: 1; id: string; attemptId: string; createdAt: string; parentRunId: string; split: "validation"; testSplitTouched: false; hypothesis: string;
  inputHashes: Record<string, string>; code: { gitCommit: string; dirty: boolean; gitDiffHash: string };
  controls: { threshold: number; topK: number; perTechnologyLimit: number; embedding: string; bothSidesGate: true; reranker: null; llmRewrite: false };
  cache: Record<string, { hits: number; misses: number; apiInputs: number; apiRequests: number; estimatedApiTokens: number; estimatedApiCostUsd: number }>;
  totals: { apiInputs: number; apiRequests: number; estimatedApiTokens: number; estimatedApiCostUsd: number };
  timingsMs: { cosineScoring: number }; results: VariantResult[]; selection: { selectedVariant: VariantId | null; reason: string }; limitations: string[];
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const protocolPath = path.resolve(options.protocol);
  const protocolRaw = await fs.readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw) as Protocol;
  validateProtocol(protocol);
  const positiveRaw = await fs.readFile(path.resolve(protocol.positiveBenchmark), "utf8");
  const negativeRaw = await fs.readFile(path.resolve(protocol.negativeBenchmark), "utf8");
  const manualRaw = await fs.readFile(path.resolve(protocol.manualReference), "utf8");
  const positives = JSON.parse(positiveRaw) as Benchmark<PositiveCase>;
  const negatives = JSON.parse(negativeRaw) as Benchmark<NegativeCase>;
  const manual = JSON.parse(manualRaw) as ManualReference;
  const runDirectory = path.resolve(protocol.parentRun);
  validateInputs(positives, negatives, manual, runDirectory);
  const allCases = [...positives.cases, ...negatives.cases];
  const manualMap = new Map(manual.cases.map((item) => [item.caseId, item.subqueries]));
  const constructions = Object.fromEntries(protocol.variants.map((item) => [item.id, constructQueries(item.id, allCases, manualMap)])) as Record<VariantId, ReturnType<typeof constructQueries>>;

  const runRaw = await fs.readFile(path.join(runDirectory, "run.json"), "utf8");
  const configRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const run = JSON.parse(runRaw) as ExperimentRun;
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (run.status !== "prepared" || config.embedding.provider !== "google" || config.embedding.model !== "gemini-embedding-2" || config.embedding.outputDimensionality !== 1024) throw new Error("Frozen prepared Gemini Embedding 2 run required.");
  validateEvidence(positives.cases, chunks);

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const common = { provider: "google" as const, model: config.embedding.model, outputDimensionality: 1024, batchSize: config.embedding.batchSize, priceUsdPerMillionTokens: config.embedding.pricing?.usdPerMillionInputTokens };
  const documents = await embedTextsWithCache(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), { ...common, taskType: config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT", titles: chunks.map((chunk) => chunk.title), allowProviderRequests: false });
  const embedded = {} as Record<VariantId, Awaited<ReturnType<typeof embedTextsWithCache>>>;
  for (const variant of protocol.variants) embedded[variant.id] = await embedTextsWithCache(constructions[variant.id].queries, { ...common, taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING", allowProviderRequests: variant.id === "manual-frozen" ? false : options.allowProviderRequests });

  const scoringStarted = performance.now();
  const results = protocol.variants.map(({ id }) => evaluateVariant(id, positives.cases, negatives.cases, chunks, documents.vectors, embedded[id].vectors, constructions[id]));
  const selection = selectVariant(results, protocol);
  const cache = Object.fromEntries(protocol.variants.map(({ id }) => [id, cacheSummary(embedded[id])])) as Artifact["cache"];
  const totals = Object.values(cache).reduce((total, item) => ({ apiInputs: total.apiInputs + item.apiInputs, apiRequests: total.apiRequests + item.apiRequests, estimatedApiTokens: total.estimatedApiTokens + item.estimatedApiTokens, estimatedApiCostUsd: total.estimatedApiCostUsd + item.estimatedApiCostUsd }), { apiInputs: 0, apiRequests: 0, estimatedApiTokens: 0, estimatedApiCostUsd: 0 });
  const createdAt = new Date().toISOString();
  const artifact: Artifact = {
    schemaVersion: 1, id: protocol.id, attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17), createdAt, parentRunId: run.runId, split: "validation", testSplitTouched: false, hypothesis: protocol.hypothesis,
    inputHashes: { protocol: sha256(protocolRaw), positives: sha256(positiveRaw), negatives: sha256(negativeRaw), manualReference: sha256(manualRaw), config: sha256(configRaw), chunks: sha256(chunksRaw) },
    code: codeProvenance(), controls: { threshold: 0.68, topK: 4, perTechnologyLimit: 2, embedding: "google/gemini-embedding-2@1024", bothSidesGate: true, reranker: null, llmRewrite: false },
    cache, totals, timingsMs: { cosineScoring: Math.round(performance.now() - scoringStarted) }, results, selection,
    limitations: ["The parser supports the comparative forms represented in this focused benchmark, not arbitrary natural language.", "The manual reference is a validation reference rather than an independent test oracle.", "The gate measures score eligibility rather than semantic entailment.", "Production behavior and the locked general test remain untouched."],
  };
  const attemptDirectory = path.join(runDirectory, "comparative-constructor-attempts", protocol.id, artifact.attemptId);
  await fs.mkdir(attemptDirectory, { recursive: true });
  await fs.writeFile(path.join(attemptDirectory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(attemptDirectory, "summary.md"), renderMarkdown(artifact));
  if (options.writeReport) await writeReport(protocol.reportOutput, artifact);
  console.log(`COMPLETED ${protocol.id}/${artifact.attemptId}`);
  for (const item of results) console.log(`${item.variant}: languages=${format(item.metrics.bothLanguageCoverageAt4)}, evidence=${format(item.metrics.bothEvidenceSideCoverageAt4)}, recall=${format(item.metrics.meanEvidenceSideRecallAt4)}, MRR=${format(item.metrics.macroEvidenceSideMrr)}, FPR=${format(item.metrics.noAnswerFalsePositiveRate)}, parse=${format(item.construction.parseSuccessRate)}`);
  console.log(`SELECTED ${selection.selectedVariant ?? "none"}: ${selection.reason}`);
  console.log(`CACHE apiInputs=${totals.apiInputs}, apiRequests=${totals.apiRequests}, estimatedCost=$${totals.estimatedApiCostUsd.toFixed(8)}`);
}

function constructQueries(variant: VariantId, cases: Array<PositiveCase | NegativeCase>, manual: Map<string, Record<string, string>>) {
  let parsed = 0;
  let fallbacks = 0;
  const queries = cases.flatMap((item) => {
    if (variant === "manual-frozen") { parsed += 1; return item.expectedLanguages.map((language) => manual.get(item.id)![language]); }
    const strategy = variant === "automatic-focus-original" ? "focus-original" : "topic-template";
    const result = buildComparativeSubqueries(item.question, item.expectedLanguages, strategy);
    if (result.parsed) parsed += 1; else fallbacks += 1;
    return item.expectedLanguages.map((language) => result.subqueries[language]);
  });
  return { queries, parseSuccessRate: parsed / cases.length, fallbackCount: fallbacks, queryCharacters: queries.reduce((total, query) => total + query.length, 0) };
}

function evaluateVariant(variant: VariantId, positives: PositiveCase[], negatives: NegativeCase[], chunks: DocumentationChunk[], documentVectors: number[][], queryVectors: number[][], construction: ReturnType<typeof constructQueries>): VariantResult {
  const allCases = [...positives, ...negatives];
  let queryIndex = 0;
  const selected = allCases.map((item) => {
    const byLanguage = item.expectedLanguages.map((language) => {
      const query = queryVectors[queryIndex++];
      return chunks.map((chunk, index) => ({ ...chunk, score: cosineSimilarity(query, documentVectors[index]) })).filter((chunk) => chunk.language === language && chunk.score >= 0.68).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, 2);
    });
    const gatePassed = byLanguage.every((group) => group.length > 0);
    return { gatePassed, chunks: gatePassed ? interleave(byLanguage).slice(0, 4) : [] };
  });
  const positiveDetails = positives.map((item, index) => {
    const result = selected[index];
    const representedLanguages = item.expectedLanguages.filter((language) => result.chunks.some((chunk) => chunk.language === language));
    const evidenceRanks = item.expectedLanguages.map((language) => { const target = item.evidenceByLanguage[language]; const rank = result.chunks.findIndex((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id)); return rank < 0 ? 0 : 1 / (rank + 1); });
    return { caseId: item.id, representedLanguages, evidenceLanguages: item.expectedLanguages.filter((_, side) => evidenceRanks[side] > 0), evidenceRanks, gatePassed: result.gatePassed, retrieved: result.chunks.map(compactChunk) };
  });
  const negativeCases = negatives.map((item, offset) => { const result = selected[positives.length + offset]; return { caseId: item.id, falsePositive: result.chunks.length > 0, gatePassed: result.gatePassed, retrieved: result.chunks.map(compactChunk) }; });
  const sideCount = positives.reduce((total, item) => total + item.expectedLanguages.length, 0);
  const represented = positiveDetails.reduce((total, item) => total + item.representedLanguages.length, 0);
  const evidence = positiveDetails.reduce((total, item) => total + item.evidenceLanguages.length, 0);
  return {
    variant, construction: { parseSuccessRate: construction.parseSuccessRate, fallbackCount: construction.fallbackCount, queryCharacters: construction.queryCharacters },
    metrics: {
      bothLanguageCoverageAt4: mean(positiveDetails.map((item, index) => Number(item.representedLanguages.length === positives[index].expectedLanguages.length))), meanLanguageSideCoverageAt4: represented / sideCount,
      bothEvidenceSideCoverageAt4: mean(positiveDetails.map((item, index) => Number(item.evidenceLanguages.length === positives[index].expectedLanguages.length))), meanEvidenceSideRecallAt4: evidence / sideCount,
      macroEvidenceSideMrr: mean(positiveDetails.flatMap((item) => item.evidenceRanks)), noAnswerFalsePositiveRate: mean(negativeCases.map((item) => Number(item.falsePositive))),
      positiveGateRejections: positiveDetails.filter((item) => !item.gatePassed).length, negativeGateRejections: negativeCases.filter((item) => !item.gatePassed).length,
      returnedChunks: positiveDetails.reduce((total, item) => total + item.retrieved.length, 0) + negativeCases.reduce((total, item) => total + item.retrieved.length, 0),
    },
    positiveCases: positiveDetails.map((item) => ({ caseId: item.caseId, representedLanguages: item.representedLanguages, evidenceLanguages: item.evidenceLanguages, gatePassed: item.gatePassed, retrieved: item.retrieved })), negativeCases,
  };
}

function selectVariant(results: VariantResult[], protocol: Protocol) {
  const rule = protocol.selectionRule.automaticEligibility;
  const eligible = results.filter((item) => item.variant !== "manual-frozen" && item.metrics.noAnswerFalsePositiveRate === rule.noAnswerFalsePositiveRate && item.metrics.positiveGateRejections === rule.positiveGateRejections && item.metrics.bothLanguageCoverageAt4 >= rule.minimumBothLanguageCoverageAt4 && item.metrics.bothEvidenceSideCoverageAt4 >= rule.minimumBothEvidenceSideCoverageAt4 && item.metrics.meanEvidenceSideRecallAt4 >= rule.minimumMeanEvidenceSideRecallAt4 && item.metrics.macroEvidenceSideMrr >= rule.minimumMacroEvidenceSideMrr && (item.variant !== "automatic-topic-template" || item.construction.parseSuccessRate === rule.requiredParseSuccessRateForTopicTemplate));
  const selected = [...eligible].sort((left, right) => right.metrics.bothEvidenceSideCoverageAt4 - left.metrics.bothEvidenceSideCoverageAt4 || right.metrics.meanEvidenceSideRecallAt4 - left.metrics.meanEvidenceSideRecallAt4 || right.metrics.macroEvidenceSideMrr - left.metrics.macroEvidenceSideMrr || left.construction.queryCharacters - right.construction.queryCharacters || Number(right.variant === "automatic-focus-original") - Number(left.variant === "automatic-focus-original"))[0];
  return selected ? { selectedVariant: selected.variant, reason: "Selected by the preregistered validation rule." } : { selectedVariant: null, reason: protocol.selectionRule.failurePolicy };
}

function validateInputs(positives: Benchmark<PositiveCase>, negatives: Benchmark<NegativeCase>, manual: ManualReference, runDirectory: string) { for (const item of [positives, negatives]) if (item.schemaVersion !== 1 || item.split !== "validation" || item.testSplitTouched !== false || path.resolve(item.parentRun) !== runDirectory) throw new Error("Benchmarks must use the same frozen validation run."); if (manual.schemaVersion !== 1 || manual.split !== "validation" || manual.testSplitTouched !== false || positives.cases.length !== 8 || negatives.cases.length !== 8 || manual.cases.length !== 16) throw new Error("Expected validation-only 8+8 constructor inputs."); const ids = new Set([...positives.cases, ...negatives.cases].map((item) => item.id)); if (new Set(manual.cases.map((item) => item.caseId)).size !== ids.size || !manual.cases.every((item) => ids.has(item.caseId))) throw new Error("Manual reference case mismatch."); }
function validateEvidence(positives: PositiveCase[], chunks: DocumentationChunk[]) { for (const item of positives) for (const language of item.expectedLanguages) { const target = item.evidenceByLanguage[language]; if (!chunks.some((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id))) throw new Error(`${item.id} missing evidence for ${language}.`); } }
function validateProtocol(protocol: Protocol) { const expected: VariantId[] = ["manual-frozen", "automatic-focus-original", "automatic-topic-template"]; if (protocol.schemaVersion !== 1 || protocol.split !== "validation" || !["preregistered", "completed"].includes(protocol.status) || !sameSet(protocol.variants.map((item) => item.id), expected)) throw new Error("Invalid constructor protocol."); }
function interleave(groups: ScoredChunk[][]) { return groups.flatMap((group) => group.map((chunk, index) => ({ chunk, sideRank: index + 1 }))).sort((left, right) => left.sideRank - right.sideRank || right.chunk.score - left.chunk.score || left.chunk.id.localeCompare(right.chunk.id)).map((item) => item.chunk); }
function cacheSummary(result: Awaited<ReturnType<(typeof import("../src/lib/rag/embeddings"))["embedTextsWithCache"]>>) { return { hits: result.cache.cacheHits, misses: result.cache.cacheMisses, apiInputs: result.apiInputs, apiRequests: result.apiRequests, estimatedApiTokens: result.cache.estimatedApiTokens, estimatedApiCostUsd: result.cache.estimatedApiCostUsd ?? 0 }; }

function renderMarkdown(artifact: Artifact) { return `# Comparative subquery constructor\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Evaluation commit: \`${artifact.code.gitCommit}\`${artifact.code.dirty ? " (dirty)" : ""}\n- Split: **validation only**; locked test touched: **no**\n- Fixed: both-sides gate, cosine >= 0.68, two chunks per technology, no reranker or LLM rewrite\n- Provider inputs: **${artifact.totals.apiInputs}** in **${artifact.totals.apiRequests}** request(s), estimated cost **$${artifact.totals.estimatedApiCostUsd.toFixed(8)}**\n\n| Constructor | Both languages @4 | Both evidence sides @4 | Evidence recall | Side MRR | Negative FPR | Positive rejects | Parse success | Query chars |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${artifact.results.map((item) => `| ${item.variant} | ${format(item.metrics.bothLanguageCoverageAt4)} | ${format(item.metrics.bothEvidenceSideCoverageAt4)} | ${format(item.metrics.meanEvidenceSideRecallAt4)} | ${format(item.metrics.macroEvidenceSideMrr)} | ${format(item.metrics.noAnswerFalsePositiveRate)} | ${item.metrics.positiveGateRejections} | ${format(item.construction.parseSuccessRate)} | ${item.construction.queryCharacters} |`).join("\n")}\n\n## Decision\n\n**${artifact.selection.selectedVariant ?? "No automatic constructor selected"}.** ${artifact.selection.reason}\n\n## Limitations\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n`; }
async function writeReport(output: string, artifact: Artifact) { const base = path.resolve(output); await fs.mkdir(path.dirname(base), { recursive: true }); await fs.writeFile(`${base}.json`, `${JSON.stringify(artifact, null, 2)}\n`); await fs.writeFile(`${base}.md`, renderMarkdown(artifact)); const rows = artifact.results.map((item) => [item.variant, item.metrics.bothLanguageCoverageAt4, item.metrics.bothEvidenceSideCoverageAt4, item.metrics.meanEvidenceSideRecallAt4, item.metrics.macroEvidenceSideMrr, item.metrics.noAnswerFalsePositiveRate, item.metrics.positiveGateRejections, item.construction.parseSuccessRate, item.construction.fallbackCount, item.construction.queryCharacters]); await fs.writeFile(`${base}.csv`, [["variant", "both_language_coverage_at_4", "both_evidence_side_coverage_at_4", "mean_evidence_side_recall_at_4", "macro_evidence_side_mrr", "no_answer_false_positive_rate", "positive_gate_rejections", "parse_success_rate", "fallback_count", "query_characters"], ...rows].map((row) => row.join(",")).join("\n") + "\n"); }
function compactChunk(chunk: ScoredChunk, index: number) { return { rank: index + 1, chunkId: chunk.id, sourceId: chunk.sourceId ?? null, language: chunk.language ?? null, section: chunk.section, score: chunk.score }; }
function codeProvenance() { const paths = ["src", "scripts", "package.json", "package-lock.json", "docs/evaluation", "docs/experiments"]; const status = runCommand("git", ["status", "--porcelain", "--", ...paths]); const diff = runCommand("git", ["diff", "--binary", "--", ...paths]); return { gitCommit: runCommand("git", ["rev-parse", "HEAD"]) || "unknown", dirty: Boolean(status), gitDiffHash: sha256(diff) }; }
function sameSet(left: string[], right: string[]) { const a = new Set(left); const b = new Set(right); return a.size === b.size && [...a].every((item) => b.has(item)); }
function mean(values: number[]) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number) { return value.toFixed(4); }
function runCommand(command: string, args: string[]) { const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true }); return result.status === 0 ? result.stdout.trim() : ""; }
function parseArgs(args: string[]) { const index = args.indexOf("--protocol"); return { protocol: index >= 0 ? args[index + 1] : "docs/experiments/comparative-subquery-constructor.v1.json", allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report") }; }

main().catch((error) => { console.error(error); process.exit(1); });
