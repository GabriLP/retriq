import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { detectQueryMetadataConstraint } from "../src/lib/rag/metadata-filter";
import type { DocumentationChunk } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

type VariantId = "balanced-single-query" | "decomposed-any-side" | "decomposed-both-sides-gate";
type EvidenceTarget = { sourceId: string; acceptedChunkIds: string[] };
type PositiveCase = { id: string; question: string; expectedLanguages: string[]; evidenceByLanguage: Record<string, EvidenceTarget> };
type NegativeCase = { id: string; question: string; expectedLanguages: string[] };
type Benchmark<T> = { schemaVersion: 1; parentRun: string; split: "validation"; testSplitTouched: false; cases: T[] };
type Decomposition = { schemaVersion: 1; split: "validation"; testSplitTouched: false; cases: Array<{ caseId: string; subqueries: Record<string, string> }> };
type Protocol = {
  schemaVersion: 1; id: string; status: "preregistered" | "completed"; split: "validation";
  positiveBenchmark: string; negativeBenchmark: string; decomposition: string; parentRun: string; hypothesis: string;
  variants: Array<{ id: VariantId; description: string }>;
  selectionRule: { eligibility: { noAnswerFalsePositiveRate: number; minimumBothLanguageCoverageAt4: number; minimumBothEvidenceSideCoverageAt4: number; minimumMeanEvidenceSideRecallAt4: number }; failurePolicy: string };
  reportOutput: string;
};
type ScoredChunk = DocumentationChunk & { score: number };
type CompactChunk = ReturnType<typeof compactChunk>;
type CaseEvaluation = { caseId: string; representedLanguages: string[]; evidenceLanguages: string[]; evidenceRanks: number[]; retrieved: CompactChunk[]; gatePassed: boolean };
type VariantResult = {
  variant: VariantId;
  metrics: { bothLanguageCoverageAt4: number; meanLanguageSideCoverageAt4: number; bothEvidenceSideCoverageAt4: number; meanEvidenceSideRecallAt4: number; macroEvidenceSideMrr: number; noAnswerFalsePositiveRate: number; positiveGateRejections: number; negativeGateRejections: number; returnedChunks: number };
  positiveCases: Array<Omit<CaseEvaluation, "evidenceRanks">>;
  negativeCases: Array<{ caseId: string; falsePositive: boolean; gatePassed: boolean; retrieved: CompactChunk[] }>;
};
type Artifact = {
  schemaVersion: 1; id: string; attemptId: string; createdAt: string; parentRunId: string; split: "validation"; testSplitTouched: false; hypothesis: string;
  inputHashes: Record<string, string>; code: { gitCommit: string; dirty: boolean; gitDiffHash: string };
  controls: { threshold: number; topK: number; perTechnologyLimit: number; embedding: string; reranker: null; llmRewrite: false };
  cache: { documentHits: number; documentMisses: number; originalQueryHits: number; originalQueryMisses: number; subqueryHits: number; subqueryMisses: number; apiInputs: number; apiRequests: number; estimatedApiTokens: number; estimatedApiCostUsd: number };
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
  const decompositionRaw = await fs.readFile(path.resolve(protocol.decomposition), "utf8");
  const positives = JSON.parse(positiveRaw) as Benchmark<PositiveCase>;
  const negatives = JSON.parse(negativeRaw) as Benchmark<NegativeCase>;
  const decomposition = JSON.parse(decompositionRaw) as Decomposition;
  const runDirectory = path.resolve(protocol.parentRun);
  validateInputs(positives, negatives, decomposition, runDirectory);

  const runRaw = await fs.readFile(path.join(runDirectory, "run.json"), "utf8");
  const configRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const run = JSON.parse(runRaw) as ExperimentRun;
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (run.status !== "prepared" || config.embedding.provider !== "google" || config.embedding.model !== "gemini-embedding-2" || config.embedding.outputDimensionality !== 1024) throw new Error("Frozen prepared Gemini Embedding 2 run required.");
  const allCases = [...positives.cases, ...negatives.cases];
  validateCases(allCases, positives.cases, decomposition, chunks);
  const decompositionByCase = new Map(decomposition.cases.map((item) => [item.caseId, item.subqueries]));
  const subqueryInputs = allCases.flatMap((item) => item.expectedLanguages.map((language) => decompositionByCase.get(item.id)![language]));

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const common = { provider: "google" as const, model: config.embedding.model, outputDimensionality: 1024, batchSize: config.embedding.batchSize, priceUsdPerMillionTokens: config.embedding.pricing?.usdPerMillionInputTokens };
  const documents = await embedTextsWithCache(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), { ...common, taskType: config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT", titles: chunks.map((chunk) => chunk.title), allowProviderRequests: false });
  const originalQueries = await embedTextsWithCache(allCases.map((item) => item.question), { ...common, taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING", allowProviderRequests: false });
  const subqueries = await embedTextsWithCache(subqueryInputs, { ...common, taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING", allowProviderRequests: options.allowProviderRequests });

  const scoringStarted = performance.now();
  const originalRankings = allCases.map((item, caseIndex) => scoreAndFilter(chunks, documents.vectors, originalQueries.vectors[caseIndex], item.expectedLanguages));
  let subqueryIndex = 0;
  const decomposedRankings = allCases.map((item) => Object.fromEntries(item.expectedLanguages.map((language) => {
    const ranking = scoreAndFilter(chunks, documents.vectors, subqueries.vectors[subqueryIndex], [language]);
    subqueryIndex += 1;
    return [language, ranking];
  })) as Record<string, ScoredChunk[]>);
  const results = protocol.variants.map((item) => evaluateVariant(item.id, positives.cases, negatives.cases, originalRankings, decomposedRankings));
  const selection = selectVariant(results, protocol);
  const createdAt = new Date().toISOString();
  const artifact: Artifact = {
    schemaVersion: 1, id: protocol.id, attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17), createdAt, parentRunId: run.runId, split: "validation", testSplitTouched: false, hypothesis: protocol.hypothesis,
    inputHashes: { protocol: sha256(protocolRaw), positives: sha256(positiveRaw), negatives: sha256(negativeRaw), decomposition: sha256(decompositionRaw), config: sha256(configRaw), chunks: sha256(chunksRaw) },
    code: codeProvenance(), controls: { threshold: 0.68, topK: 4, perTechnologyLimit: 2, embedding: "google/gemini-embedding-2@1024", reranker: null, llmRewrite: false },
    cache: {
      documentHits: documents.cache.cacheHits, documentMisses: documents.cache.cacheMisses,
      originalQueryHits: originalQueries.cache.cacheHits, originalQueryMisses: originalQueries.cache.cacheMisses,
      subqueryHits: subqueries.cache.cacheHits, subqueryMisses: subqueries.cache.cacheMisses,
      apiInputs: documents.apiInputs + originalQueries.apiInputs + subqueries.apiInputs, apiRequests: documents.apiRequests + originalQueries.apiRequests + subqueries.apiRequests,
      estimatedApiTokens: documents.cache.estimatedApiTokens + originalQueries.cache.estimatedApiTokens + subqueries.cache.estimatedApiTokens,
      estimatedApiCostUsd: (documents.cache.estimatedApiCostUsd ?? 0) + (originalQueries.cache.estimatedApiCostUsd ?? 0) + (subqueries.cache.estimatedApiCostUsd ?? 0),
    },
    timingsMs: { cosineScoring: Math.round(performance.now() - scoringStarted) }, results, selection,
    limitations: ["Subqueries are manually frozen deterministic rewrites, not generated dynamically.", "The both-sides gate measures score eligibility, not semantic entailment.", "Eight positive and eight negative validation cases remain a focused benchmark.", "Production behavior and the locked general test split remain untouched."],
  };
  const attemptDirectory = path.join(runDirectory, "comparative-decomposition-attempts", protocol.id, artifact.attemptId);
  await fs.mkdir(attemptDirectory, { recursive: true });
  await fs.writeFile(path.join(attemptDirectory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(attemptDirectory, "summary.md"), renderMarkdown(artifact));
  if (options.writeReport) await writeReport(protocol.reportOutput, artifact);
  console.log(`COMPLETED ${protocol.id}/${artifact.attemptId}`);
  for (const item of results) console.log(`${item.variant}: languages=${format(item.metrics.bothLanguageCoverageAt4)}, evidence=${format(item.metrics.bothEvidenceSideCoverageAt4)}, sideRecall=${format(item.metrics.meanEvidenceSideRecallAt4)}, FPR=${format(item.metrics.noAnswerFalsePositiveRate)}, gates=${item.metrics.positiveGateRejections}/${item.metrics.negativeGateRejections}`);
  console.log(`SELECTED ${selection.selectedVariant ?? "none"}: ${selection.reason}`);
  console.log(`CACHE subqueries=${subqueries.cache.cacheHits}/${subqueryInputs.length}, apiInputs=${artifact.cache.apiInputs}, estimatedCost=$${artifact.cache.estimatedApiCostUsd.toFixed(8)}`);
}

function scoreAndFilter(chunks: DocumentationChunk[], vectors: number[][], query: number[], languages: string[]) {
  const allowed = new Set(languages);
  return chunks.map((chunk, index) => ({ ...chunk, score: cosineSimilarity(query, vectors[index]) })).filter((chunk) => chunk.language && allowed.has(chunk.language)).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function evaluateVariant(variant: VariantId, positives: PositiveCase[], negatives: NegativeCase[], originals: ScoredChunk[][], decomposed: Array<Record<string, ScoredChunk[]>>): VariantResult {
  const allCases = [...positives, ...negatives];
  const selected = allCases.map((item, index) => {
    if (variant === "balanced-single-query") {
      const chunks = balanceByLanguage(originals[index].filter((chunk) => chunk.score >= 0.68)).slice(0, 4);
      return { chunks, gatePassed: chunks.length > 0 };
    }
    const byLanguage = item.expectedLanguages.map((language) => decomposed[index][language].filter((chunk) => chunk.score >= 0.68).slice(0, 2));
    const gatePassed = byLanguage.every((chunks) => chunks.length > 0);
    const chunks = interleave(byLanguage).slice(0, 4);
    return { chunks: variant === "decomposed-both-sides-gate" && !gatePassed ? [] : chunks, gatePassed };
  });
  const positiveCases: CaseEvaluation[] = positives.map((item, index) => evaluatePositive(item, selected[index].chunks, selected[index].gatePassed));
  const negativeCases = negatives.map((item, offset) => {
    const result = selected[positives.length + offset];
    return { caseId: item.id, falsePositive: result.chunks.length > 0, gatePassed: result.gatePassed, retrieved: result.chunks.map(compactChunk) };
  });
  const sideCount = positives.reduce((total, item) => total + item.expectedLanguages.length, 0);
  const representedSides = positiveCases.reduce((total, item) => total + item.representedLanguages.length, 0);
  const evidenceSides = positiveCases.reduce((total, item) => total + item.evidenceLanguages.length, 0);
  return {
    variant,
    metrics: {
      bothLanguageCoverageAt4: mean(positiveCases.map((item, index) => Number(item.representedLanguages.length === positives[index].expectedLanguages.length))),
      meanLanguageSideCoverageAt4: representedSides / sideCount,
      bothEvidenceSideCoverageAt4: mean(positiveCases.map((item, index) => Number(item.evidenceLanguages.length === positives[index].expectedLanguages.length))),
      meanEvidenceSideRecallAt4: evidenceSides / sideCount,
      macroEvidenceSideMrr: mean(positiveCases.flatMap((item) => item.evidenceRanks)),
      noAnswerFalsePositiveRate: mean(negativeCases.map((item) => Number(item.falsePositive))),
      positiveGateRejections: positiveCases.filter((item) => !item.gatePassed).length,
      negativeGateRejections: negativeCases.filter((item) => !item.gatePassed).length,
      returnedChunks: positiveCases.reduce((total, item) => total + item.retrieved.length, 0) + negativeCases.reduce((total, item) => total + item.retrieved.length, 0),
    },
    positiveCases: positiveCases.map((item) => ({ caseId: item.caseId, representedLanguages: item.representedLanguages, evidenceLanguages: item.evidenceLanguages, retrieved: item.retrieved, gatePassed: item.gatePassed })),
    negativeCases,
  };
}

function evaluatePositive(item: PositiveCase, chunks: ScoredChunk[], gatePassed: boolean): CaseEvaluation {
  const representedLanguages = item.expectedLanguages.filter((language) => chunks.some((chunk) => chunk.language === language));
  const evidenceRanks = item.expectedLanguages.map((language) => { const target = item.evidenceByLanguage[language]; const index = chunks.findIndex((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id)); return index < 0 ? 0 : 1 / (index + 1); });
  return { caseId: item.id, representedLanguages, evidenceLanguages: item.expectedLanguages.filter((_, index) => evidenceRanks[index] > 0), evidenceRanks, retrieved: chunks.map(compactChunk), gatePassed };
}

function selectVariant(results: VariantResult[], protocol: Protocol) {
  const rule = protocol.selectionRule.eligibility;
  const eligible = results.filter((item) => item.metrics.noAnswerFalsePositiveRate === rule.noAnswerFalsePositiveRate && item.metrics.bothLanguageCoverageAt4 >= rule.minimumBothLanguageCoverageAt4 && item.metrics.bothEvidenceSideCoverageAt4 >= rule.minimumBothEvidenceSideCoverageAt4 && item.metrics.meanEvidenceSideRecallAt4 >= rule.minimumMeanEvidenceSideRecallAt4);
  const simplicity: Record<VariantId, number> = { "balanced-single-query": 0, "decomposed-any-side": 1, "decomposed-both-sides-gate": 2 };
  const selected = [...eligible].sort((left, right) => right.metrics.bothEvidenceSideCoverageAt4 - left.metrics.bothEvidenceSideCoverageAt4 || right.metrics.bothLanguageCoverageAt4 - left.metrics.bothLanguageCoverageAt4 || right.metrics.meanEvidenceSideRecallAt4 - left.metrics.meanEvidenceSideRecallAt4 || right.metrics.macroEvidenceSideMrr - left.metrics.macroEvidenceSideMrr || left.metrics.returnedChunks - right.metrics.returnedChunks || simplicity[left.variant] - simplicity[right.variant])[0];
  return selected ? { selectedVariant: selected.variant, reason: "Selected by the preregistered validation rule." } : { selectedVariant: null, reason: protocol.selectionRule.failurePolicy };
}

function balanceByLanguage(chunks: ScoredChunk[]) { const ranks = new Map<string, number>(); return chunks.map((chunk) => { const language = chunk.language ?? ""; const languageRank = (ranks.get(language) ?? 0) + 1; ranks.set(language, languageRank); return { chunk, languageRank }; }).sort((left, right) => left.languageRank - right.languageRank || right.chunk.score - left.chunk.score || left.chunk.id.localeCompare(right.chunk.id)).map((item) => item.chunk); }
function interleave(groups: ScoredChunk[][]) { return groups.flatMap((group) => group.map((chunk, index) => ({ chunk, sideRank: index + 1 }))).sort((left, right) => left.sideRank - right.sideRank || right.chunk.score - left.chunk.score || left.chunk.id.localeCompare(right.chunk.id)).map((item) => item.chunk); }

function validateInputs(positives: Benchmark<PositiveCase>, negatives: Benchmark<NegativeCase>, decomposition: Decomposition, runDirectory: string) {
  for (const item of [positives, negatives]) if (item.schemaVersion !== 1 || item.split !== "validation" || item.testSplitTouched !== false || path.resolve(item.parentRun) !== runDirectory) throw new Error("Benchmarks must use the same frozen validation run.");
  if (decomposition.schemaVersion !== 1 || decomposition.split !== "validation" || decomposition.testSplitTouched !== false || positives.cases.length !== 8 || negatives.cases.length !== 8) throw new Error("Expected validation-only 8+8 decomposition inputs.");
}

function validateCases(allCases: Array<PositiveCase | NegativeCase>, positives: PositiveCase[], decomposition: Decomposition, chunks: DocumentationChunk[]) {
  const map = new Map(decomposition.cases.map((item) => [item.caseId, item.subqueries]));
  if (map.size !== allCases.length || !allCases.every((item) => map.has(item.id))) throw new Error("Decomposition must cover every case exactly once.");
  for (const item of allCases) {
    const detected = detectQueryMetadataConstraint(item.question)?.databaseLanguages ?? [];
    if (!sameSet(detected, item.expectedLanguages) || !sameSet(Object.keys(map.get(item.id) ?? {}), item.expectedLanguages)) throw new Error(`${item.id} has inconsistent technologies or subqueries.`);
  }
  for (const item of positives) for (const language of item.expectedLanguages) { const target = item.evidenceByLanguage[language]; if (!chunks.some((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id))) throw new Error(`${item.id} missing frozen evidence for ${language}.`); }
}

function validateProtocol(protocol: Protocol) { const variants: VariantId[] = ["balanced-single-query", "decomposed-any-side", "decomposed-both-sides-gate"]; if (protocol.schemaVersion !== 1 || protocol.split !== "validation" || !["preregistered", "completed"].includes(protocol.status) || !sameSet(protocol.variants.map((item) => item.id), variants)) throw new Error("Invalid decomposition protocol."); }

function renderMarkdown(artifact: Artifact) {
  return `# Comparative query decomposition\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Evaluation commit: \`${artifact.code.gitCommit}\`${artifact.code.dirty ? " (dirty)" : ""}\n- Split: **validation only**; locked test touched: **no**\n- Fixed: cosine >= 0.68, maximum four chunks, no reranker\n- New subquery provider inputs: **${artifact.cache.apiInputs}**, estimated cost **$${artifact.cache.estimatedApiCostUsd.toFixed(8)}**\n\n| Variant | Both languages @4 | Both evidence sides @4 | Evidence-side recall | Side MRR | Negative FPR | Positive gate rejects | Negative gate rejects |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${artifact.results.map((item) => `| ${item.variant} | ${format(item.metrics.bothLanguageCoverageAt4)} | ${format(item.metrics.bothEvidenceSideCoverageAt4)} | ${format(item.metrics.meanEvidenceSideRecallAt4)} | ${format(item.metrics.macroEvidenceSideMrr)} | ${format(item.metrics.noAnswerFalsePositiveRate)} | ${item.metrics.positiveGateRejections} | ${item.metrics.negativeGateRejections} |`).join("\n")}\n\n## Decision\n\n**${artifact.selection.selectedVariant ?? "No architecture selected"}.** ${artifact.selection.reason}\n\n## Limitations\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

async function writeReport(output: string, artifact: Artifact) { const base = path.resolve(output); await fs.mkdir(path.dirname(base), { recursive: true }); await fs.writeFile(`${base}.json`, `${JSON.stringify(artifact, null, 2)}\n`); await fs.writeFile(`${base}.md`, renderMarkdown(artifact)); const rows = artifact.results.map((item) => [item.variant, item.metrics.bothLanguageCoverageAt4, item.metrics.bothEvidenceSideCoverageAt4, item.metrics.meanEvidenceSideRecallAt4, item.metrics.macroEvidenceSideMrr, item.metrics.noAnswerFalsePositiveRate, item.metrics.positiveGateRejections, item.metrics.negativeGateRejections]); await fs.writeFile(`${base}.csv`, [["variant", "both_language_coverage_at_4", "both_evidence_side_coverage_at_4", "mean_evidence_side_recall_at_4", "macro_evidence_side_mrr", "no_answer_false_positive_rate", "positive_gate_rejections", "negative_gate_rejections"], ...rows].map((row) => row.join(",")).join("\n") + "\n"); }
function compactChunk(chunk: ScoredChunk, index: number) { return { rank: index + 1, chunkId: chunk.id, sourceId: chunk.sourceId ?? null, language: chunk.language ?? null, section: chunk.section, score: chunk.score }; }
function codeProvenance() { const paths = ["src", "scripts", "package.json", "package-lock.json", "docs/evaluation", "docs/experiments"]; const status = runCommand("git", ["status", "--porcelain", "--", ...paths]); const diff = runCommand("git", ["diff", "--binary", "--", ...paths]); return { gitCommit: runCommand("git", ["rev-parse", "HEAD"]) || "unknown", dirty: Boolean(status), gitDiffHash: sha256(diff) }; }
function sameSet(left: string[], right: string[]) { const a = new Set(left); const b = new Set(right); return a.size === b.size && [...a].every((item) => b.has(item)); }
function mean(values: number[]) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number) { return value.toFixed(4); }
function runCommand(command: string, args: string[]) { const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true }); return result.status === 0 ? result.stdout.trim() : ""; }
function parseArgs(args: string[]) { const index = args.indexOf("--protocol"); return { protocol: index >= 0 ? args[index + 1] : "docs/experiments/comparative-query-decomposition.v1.json", allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report") }; }

main().catch((error) => { console.error(error); process.exit(1); });
