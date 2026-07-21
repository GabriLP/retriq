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

type EvidenceTarget = { sourceId: string; acceptedChunkIds: string[] };
type PositiveCase = { id: string; question: string; expectedLanguages: string[]; evidenceByLanguage: Record<string, EvidenceTarget> };
type NegativeCase = { id: string; question: string; expectedLanguages: string[]; answerability: "unanswerable"; scopeBasis: string; absenceProbes: string[] };
type PositiveBenchmark = { schemaVersion: 1; parentRun: string; split: "validation"; testSplitTouched: false; cases: PositiveCase[] };
type NegativeBenchmark = { schemaVersion: 1; parentRun: string; split: "validation"; testSplitTouched: false; cases: NegativeCase[] };
type Protocol = {
  schemaVersion: 1;
  id: string;
  status: "preregistered" | "completed";
  split: "validation";
  positiveBenchmark: string;
  negativeBenchmark: string;
  parentRun: string;
  hypothesis: string;
  thresholds: number[];
  changedVariable: string;
  controlledVariables: string[];
  selectionRule: {
    eligibility: { noAnswerFalsePositiveRate: number; minimumBothLanguageCoverageAt4: number; minimumBothEvidenceSideCoverageAt4: number; minimumMeanEvidenceSideRecallAt4: number };
    primary: string;
    tieBreakers: string[];
    failurePolicy: string;
  };
  reportOutput: string;
};
type ScoredChunk = DocumentationChunk & { score: number };
type ThresholdResult = {
  threshold: number;
  bothLanguageCoverageAt4: number;
  meanLanguageSideCoverageAt4: number;
  bothEvidenceSideCoverageAt4: number;
  meanEvidenceSideRecallAt4: number;
  macroEvidenceSideMrr: number;
  noAnswerFalsePositiveRate: number;
  positiveReturnedChunks: number;
  negativeReturnedChunks: number;
  positiveCases: Array<{ caseId: string; representedLanguages: string[]; evidenceLanguages: string[]; retrieved: ReturnType<typeof compactChunk>[] }>;
  negativeCases: Array<{ caseId: string; falsePositive: boolean; retrieved: ReturnType<typeof compactChunk>[] }>;
};
type Artifact = {
  schemaVersion: 1;
  id: string;
  attemptId: string;
  createdAt: string;
  parentRunId: string;
  split: "validation";
  testSplitTouched: false;
  hypothesis: string;
  inputHashes: Record<string, string>;
  code: { gitCommit: string; dirty: boolean; gitDiffHash: string };
  controls: { topK: number; balancing: string; embedding: string; reranker: null };
  cache: { documentHits: number; documentMisses: number; queryHits: number; queryMisses: number; apiInputs: number; apiRequests: number; estimatedApiTokens: number; estimatedApiCostUsd: number };
  scoreDiagnostics: { maximumNegativeTopScore: number | null; minimumPositiveTopScore: number | null; minimumPositiveSecondLanguageTopScore: number | null };
  timingsMs: { cosineScoring: number };
  results: ThresholdResult[];
  selection: { selectedThreshold: number | null; reason: string };
  limitations: string[];
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
  const positives = JSON.parse(positiveRaw) as PositiveBenchmark;
  const negatives = JSON.parse(negativeRaw) as NegativeBenchmark;
  const runDirectory = path.resolve(protocol.parentRun);
  validateBenchmarks(positives, negatives, runDirectory);

  const runRaw = await fs.readFile(path.join(runDirectory, "run.json"), "utf8");
  const configRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const run = JSON.parse(runRaw) as ExperimentRun;
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (run.status !== "prepared") throw new Error("Parent run must be prepared.");
  if (config.embedding.provider !== "google" || config.embedding.model !== "gemini-embedding-2" || config.embedding.outputDimensionality !== 1024) throw new Error("Frozen Gemini Embedding 2 configuration required.");
  validateCases(positives.cases, negatives.cases, chunks);

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const documents = await embedTextsWithCache(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), {
    provider: "google", model: config.embedding.model, taskType: config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT",
    outputDimensionality: 1024, titles: chunks.map((chunk) => chunk.title), batchSize: config.embedding.batchSize,
    priceUsdPerMillionTokens: config.embedding.pricing?.usdPerMillionInputTokens, allowProviderRequests: false,
  });
  const allCases = [...positives.cases, ...negatives.cases];
  const queries = await embedTextsWithCache(allCases.map((item) => item.question), {
    provider: "google", model: config.embedding.model, taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING",
    outputDimensionality: 1024, batchSize: config.embedding.batchSize,
    priceUsdPerMillionTokens: config.embedding.pricing?.usdPerMillionInputTokens, allowProviderRequests: options.allowProviderRequests,
  });

  const scoringStarted = performance.now();
  const rankings = allCases.map((testCase, caseIndex) => {
    const languages = new Set(testCase.expectedLanguages);
    return chunks.map((chunk, chunkIndex) => ({ ...chunk, score: cosineSimilarity(queries.vectors[caseIndex], documents.vectors[chunkIndex]) }))
      .filter((chunk) => chunk.language && languages.has(chunk.language))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  });
  const results = protocol.thresholds.map((threshold) => evaluateThreshold(threshold, positives.cases, negatives.cases, rankings));
  const selection = selectThreshold(results, protocol);
  const createdAt = new Date().toISOString();
  const artifact: Artifact = {
    schemaVersion: 1,
    id: protocol.id,
    attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17),
    createdAt,
    parentRunId: run.runId,
    split: "validation",
    testSplitTouched: false,
    hypothesis: protocol.hypothesis,
    inputHashes: { protocol: sha256(protocolRaw), positives: sha256(positiveRaw), negatives: sha256(negativeRaw), config: sha256(configRaw), chunks: sha256(chunksRaw) },
    code: codeProvenance(),
    controls: { topK: 4, balancing: "language-rank-then-cosine", embedding: "google/gemini-embedding-2@1024", reranker: null },
    cache: { documentHits: documents.cache.cacheHits, documentMisses: documents.cache.cacheMisses, queryHits: queries.cache.cacheHits, queryMisses: queries.cache.cacheMisses, apiInputs: documents.apiInputs + queries.apiInputs, apiRequests: documents.apiRequests + queries.apiRequests, estimatedApiTokens: documents.cache.estimatedApiTokens + queries.cache.estimatedApiTokens, estimatedApiCostUsd: (documents.cache.estimatedApiCostUsd ?? 0) + (queries.cache.estimatedApiCostUsd ?? 0) },
    scoreDiagnostics: {
      maximumNegativeTopScore: maximum(rankings.slice(positives.cases.length).map((ranking) => ranking[0]?.score)),
      minimumPositiveTopScore: minimum(rankings.slice(0, positives.cases.length).map((ranking) => ranking[0]?.score)),
      minimumPositiveSecondLanguageTopScore: minimum(positives.cases.map((item, index) => Math.min(...item.expectedLanguages.map((language) => rankings[index].find((chunk) => chunk.language === language)?.score ?? -1)))),
    },
    timingsMs: { cosineScoring: Math.round(performance.now() - scoringStarted) },
    results,
    selection,
    limitations: ["Eight positive and eight negative comparative validation cases remain a focused calibration set.", "Exact absence probes are sanity checks rather than semantic proof.", "Only the cosine threshold changes; topK remains four.", "The locked general test split remains untouched."],
  };
  const attemptDirectory = path.join(runDirectory, "comparative-threshold-attempts", protocol.id, artifact.attemptId);
  await fs.mkdir(attemptDirectory, { recursive: true });
  await fs.writeFile(path.join(attemptDirectory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(attemptDirectory, "summary.md"), renderMarkdown(artifact));
  if (options.writeReport) await writeReport(protocol.reportOutput, artifact);
  console.log(`COMPLETED ${protocol.id}/${artifact.attemptId}`);
  for (const item of results) console.log(`${item.threshold.toFixed(2)}: languages=${format(item.bothLanguageCoverageAt4)}, evidence=${format(item.bothEvidenceSideCoverageAt4)}, sideRecall=${format(item.meanEvidenceSideRecallAt4)}, FPR=${format(item.noAnswerFalsePositiveRate)}`);
  console.log(`SELECTED ${selection.selectedThreshold ?? "none"}: ${selection.reason}`);
  console.log(`CACHE queries=${queries.cache.cacheHits}/${allCases.length}, apiInputs=${artifact.cache.apiInputs}, estimatedCost=$${artifact.cache.estimatedApiCostUsd.toFixed(8)}`);
}

function evaluateThreshold(threshold: number, positives: PositiveCase[], negatives: NegativeCase[], rankings: ScoredChunk[][]): ThresholdResult {
  const positiveCases = positives.map((testCase, index) => {
    const retrieved = balanceByLanguage(rankings[index].filter((chunk) => chunk.score >= threshold)).slice(0, 4);
    const representedLanguages = testCase.expectedLanguages.filter((language) => retrieved.some((chunk) => chunk.language === language));
    const evidenceRanks = testCase.expectedLanguages.map((language) => {
      const target = testCase.evidenceByLanguage[language];
      const rank = retrieved.findIndex((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id));
      return rank < 0 ? 0 : 1 / (rank + 1);
    });
    return { caseId: testCase.id, representedLanguages, evidenceLanguages: testCase.expectedLanguages.filter((_, side) => evidenceRanks[side] > 0), evidenceRanks, retrieved: retrieved.map(compactChunk) };
  });
  const negativeCases = negatives.map((testCase, offset) => {
    const retrieved = balanceByLanguage(rankings[positives.length + offset].filter((chunk) => chunk.score >= threshold)).slice(0, 4);
    return { caseId: testCase.id, falsePositive: retrieved.length > 0, retrieved: retrieved.map(compactChunk) };
  });
  const sideCount = positives.reduce((total, item) => total + item.expectedLanguages.length, 0);
  const representedSides = positiveCases.reduce((total, item) => total + item.representedLanguages.length, 0);
  const evidenceSides = positiveCases.reduce((total, item) => total + item.evidenceLanguages.length, 0);
  const reciprocalRanks = positiveCases.flatMap((item) => item.evidenceRanks);
  return {
    threshold,
    bothLanguageCoverageAt4: mean(positiveCases.map((item, index) => Number(item.representedLanguages.length === positives[index].expectedLanguages.length))),
    meanLanguageSideCoverageAt4: representedSides / sideCount,
    bothEvidenceSideCoverageAt4: mean(positiveCases.map((item, index) => Number(item.evidenceLanguages.length === positives[index].expectedLanguages.length))),
    meanEvidenceSideRecallAt4: evidenceSides / sideCount,
    macroEvidenceSideMrr: mean(reciprocalRanks),
    noAnswerFalsePositiveRate: mean(negativeCases.map((item) => Number(item.falsePositive))),
    positiveReturnedChunks: positiveCases.reduce((total, item) => total + item.retrieved.length, 0),
    negativeReturnedChunks: negativeCases.reduce((total, item) => total + item.retrieved.length, 0),
    positiveCases: positiveCases.map((item) => ({ caseId: item.caseId, representedLanguages: item.representedLanguages, evidenceLanguages: item.evidenceLanguages, retrieved: item.retrieved })),
    negativeCases,
  };
}

function selectThreshold(results: ThresholdResult[], protocol: Protocol) {
  const rule = protocol.selectionRule.eligibility;
  const eligible = results.filter((item) => item.noAnswerFalsePositiveRate === rule.noAnswerFalsePositiveRate && item.bothLanguageCoverageAt4 >= rule.minimumBothLanguageCoverageAt4 && item.bothEvidenceSideCoverageAt4 >= rule.minimumBothEvidenceSideCoverageAt4 && item.meanEvidenceSideRecallAt4 >= rule.minimumMeanEvidenceSideRecallAt4);
  const selected = [...eligible].sort((left, right) => right.bothEvidenceSideCoverageAt4 - left.bothEvidenceSideCoverageAt4 || right.bothLanguageCoverageAt4 - left.bothLanguageCoverageAt4 || right.meanEvidenceSideRecallAt4 - left.meanEvidenceSideRecallAt4 || right.macroEvidenceSideMrr - left.macroEvidenceSideMrr || right.threshold - left.threshold)[0];
  return selected ? { selectedThreshold: selected.threshold, reason: "Selected by the preregistered validation rule." } : { selectedThreshold: null, reason: protocol.selectionRule.failurePolicy };
}

function balanceByLanguage(chunks: ScoredChunk[]) {
  const ranks = new Map<string, number>();
  return chunks.map((chunk) => { const language = chunk.language ?? ""; const languageRank = (ranks.get(language) ?? 0) + 1; ranks.set(language, languageRank); return { chunk, languageRank }; })
    .sort((left, right) => left.languageRank - right.languageRank || right.chunk.score - left.chunk.score || left.chunk.id.localeCompare(right.chunk.id)).map((item) => item.chunk);
}

function validateCases(positives: PositiveCase[], negatives: NegativeCase[], chunks: DocumentationChunk[]) {
  for (const item of [...positives, ...negatives]) {
    const detected = detectQueryMetadataConstraint(item.question)?.databaseLanguages ?? [];
    if (!sameSet(detected, item.expectedLanguages)) throw new Error(`${item.id} metadata detection mismatch: ${detected.join(", ")}.`);
  }
  for (const item of positives) for (const language of item.expectedLanguages) {
    const target = item.evidenceByLanguage[language];
    if (!chunks.some((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id))) throw new Error(`${item.id} missing evidence for ${language}.`);
  }
  for (const item of negatives) {
    const constrainedText = chunks.filter((chunk) => chunk.language && item.expectedLanguages.includes(chunk.language)).map((chunk) => `${chunk.section}\n${chunk.content}`).join("\n").toLocaleLowerCase("en");
    const found = item.absenceProbes.filter((probe) => constrainedText.includes(probe.toLocaleLowerCase("en")));
    if (found.length) throw new Error(`${item.id} absence probes found in constrained corpus: ${found.join(", ")}.`);
  }
}

function validateBenchmarks(positives: PositiveBenchmark, negatives: NegativeBenchmark, runDirectory: string) {
  for (const item of [positives, negatives]) if (item.schemaVersion !== 1 || item.split !== "validation" || item.testSplitTouched !== false || path.resolve(item.parentRun) !== runDirectory) throw new Error("Benchmarks must reference the same validation-only frozen run.");
  if (positives.cases.length !== 8 || negatives.cases.length !== 8) throw new Error("Calibration requires eight positive and eight negative cases.");
}

function validateProtocol(protocol: Protocol) {
  if (protocol.schemaVersion !== 1 || protocol.split !== "validation" || !["preregistered", "completed"].includes(protocol.status)) throw new Error("Invalid protocol.");
  if (!protocol.thresholds.length || new Set(protocol.thresholds).size !== protocol.thresholds.length || protocol.thresholds.some((value) => value < -1 || value > 1)) throw new Error("Invalid threshold grid.");
}

function renderMarkdown(artifact: Artifact) {
  return `# Comparative-query threshold calibration\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Evaluation commit: \`${artifact.code.gitCommit}\`${artifact.code.dirty ? " (dirty)" : ""}\n- Split: **validation only**; locked test touched: **no**\n- Cases: **8 answerable + 8 unanswerable**\n- Changed variable: minimum cosine threshold\n- Fixed: balanced multi-technology retrieval, topK=4, no reranker\n- Provider inputs this run: **${artifact.cache.apiInputs}**, estimated cost **$${artifact.cache.estimatedApiCostUsd.toFixed(8)}**\n\n| Threshold | Both languages @4 | Both evidence sides @4 | Evidence-side recall | Side MRR | Negative FPR | Positive chunks | Negative chunks |\n|---:|---:|---:|---:|---:|---:|---:|---:|\n${artifact.results.map((item) => `| ${item.threshold.toFixed(2)} | ${format(item.bothLanguageCoverageAt4)} | ${format(item.bothEvidenceSideCoverageAt4)} | ${format(item.meanEvidenceSideRecallAt4)} | ${format(item.macroEvidenceSideMrr)} | ${format(item.noAnswerFalsePositiveRate)} | ${item.positiveReturnedChunks} | ${item.negativeReturnedChunks} |`).join("\n")}\n\n## Decision\n\n**${artifact.selection.selectedThreshold === null ? "No threshold selected" : `Selected ${artifact.selection.selectedThreshold.toFixed(2)}`}**. ${artifact.selection.reason}\n\n## Score diagnostics\n\n- Maximum negative top score: ${format(artifact.scoreDiagnostics.maximumNegativeTopScore)}\n- Minimum positive top score: ${format(artifact.scoreDiagnostics.minimumPositiveTopScore)}\n- Minimum best score for the weaker positive language side: ${format(artifact.scoreDiagnostics.minimumPositiveSecondLanguageTopScore)}\n\n## Limitations\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

async function writeReport(output: string, artifact: Artifact) {
  const base = path.resolve(output); await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(`${base}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${base}.md`, renderMarkdown(artifact));
  const rows = artifact.results.map((item) => [item.threshold, item.bothLanguageCoverageAt4, item.bothEvidenceSideCoverageAt4, item.meanEvidenceSideRecallAt4, item.macroEvidenceSideMrr, item.noAnswerFalsePositiveRate, item.positiveReturnedChunks, item.negativeReturnedChunks]);
  await fs.writeFile(`${base}.csv`, [["threshold", "both_language_coverage_at_4", "both_evidence_side_coverage_at_4", "mean_evidence_side_recall_at_4", "macro_evidence_side_mrr", "no_answer_false_positive_rate", "positive_returned_chunks", "negative_returned_chunks"], ...rows].map((row) => row.join(",")).join("\n") + "\n");
}

function compactChunk(chunk: ScoredChunk, index: number) { return { rank: index + 1, chunkId: chunk.id, sourceId: chunk.sourceId ?? null, language: chunk.language ?? null, section: chunk.section, score: chunk.score }; }
function codeProvenance() { const paths = ["src", "scripts", "package.json", "package-lock.json", "docs/evaluation", "docs/experiments"]; const status = runCommand("git", ["status", "--porcelain", "--", ...paths]); const diff = runCommand("git", ["diff", "--binary", "--", ...paths]); return { gitCommit: runCommand("git", ["rev-parse", "HEAD"]) || "unknown", dirty: Boolean(status), gitDiffHash: sha256(diff) }; }
function sameSet(left: string[], right: string[]) { const a = new Set(left); const b = new Set(right); return a.size === b.size && [...a].every((item) => b.has(item)); }
function mean(values: number[]) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function minimum(values: Array<number | undefined>) { const finite = values.filter((value): value is number => value !== undefined && Number.isFinite(value)); return finite.length ? Math.min(...finite) : null; }
function maximum(values: Array<number | undefined>) { const finite = values.filter((value): value is number => value !== undefined && Number.isFinite(value)); return finite.length ? Math.max(...finite) : null; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number | null) { return value === null ? "n/a" : value.toFixed(4); }
function runCommand(command: string, args: string[]) { const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true }); return result.status === 0 ? result.stdout.trim() : ""; }
function parseArgs(args: string[]) { const index = args.indexOf("--protocol"); return { protocol: index >= 0 ? args[index + 1] : "docs/experiments/comparative-threshold-calibration.v1.json", allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report") }; }

main().catch((error) => { console.error(error); process.exit(1); });
