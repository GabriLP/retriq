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

type VariantId = "legacy-first-technology" | "multi-technology-unbalanced" | "multi-technology-balanced";
type EvidenceTarget = { sourceId: string; acceptedChunkIds: string[] };
type BenchmarkCase = {
  id: string;
  question: string;
  expectedLanguages: string[];
  legacyLanguage: string;
  evidenceByLanguage: Record<string, EvidenceTarget>;
};
type Benchmark = {
  schemaVersion: 1;
  id: string;
  parentRun: string;
  split: "validation";
  testSplitTouched: false;
  cases: BenchmarkCase[];
};
type Protocol = {
  schemaVersion: 1;
  id: string;
  status: "preregistered" | "completed";
  split: "validation";
  benchmark: string;
  parentRun: string;
  hypothesis: string;
  variants: Array<{ id: VariantId; description: string }>;
  changedVariable: string;
  controlledVariables: string[];
  metrics: string[];
  decisionRule: { eligibility: string; primary: string; tieBreakers: string[]; scope: string };
  reportOutput: string;
};
type ScoredChunk = DocumentationChunk & { score: number };
type CaseResult = {
  caseId: string;
  expectedLanguages: string[];
  detectedLanguages: string[];
  retrieved: Array<{ rank: number; chunkId: string; sourceId: string | null; language: string | null; section: string; score: number }>;
  representedLanguages: string[];
  evidenceLanguages: string[];
  languageSideCoverage: number;
  bothLanguagesCovered: boolean;
  evidenceSideRecall: number;
  bothEvidenceSidesCovered: boolean;
  evidenceSideReciprocalRanks: Record<string, number>;
};
type VariantResult = {
  variant: VariantId;
  cases: CaseResult[];
  metrics: {
    bothLanguageCoverageAt4: number;
    meanLanguageSideCoverageAt4: number;
    bothEvidenceSideCoverageAt4: number;
    meanEvidenceSideRecallAt4: number;
    macroEvidenceSideMrr: number;
    returnedChunks: number;
  };
};
type Artifact = {
  schemaVersion: 1;
  id: string;
  attemptId: string;
  createdAt: string;
  parentRunId: string;
  hypothesis: string;
  split: "validation";
  testSplitTouched: false;
  inputHashes: Record<string, string>;
  code: { gitCommit: string; dirty: boolean; gitDiffHash: string };
  controls: { minScore: number; topK: number; embeddingProvider: string; embeddingModel: string; outputDimensionality: number; reranker: null };
  cache: { documentHits: number; documentMisses: number; queryHits: number; queryMisses: number; apiInputs: number; apiRequests: number; estimatedApiTokens: number; estimatedApiCostUsd: number };
  timingsMs: { cosineScoring: number };
  detection: Array<{ caseId: string; expectedLanguages: string[]; detectedLanguages: string[] }>;
  results: VariantResult[];
  selection: { selectedVariant: VariantId | null; reason: string };
  limitations: string[];
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const protocolPath = path.resolve(options.protocol);
  const protocolRaw = await fs.readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw) as Protocol;
  validateProtocol(protocol);
  const benchmarkPath = path.resolve(protocol.benchmark);
  const benchmarkRaw = await fs.readFile(benchmarkPath, "utf8");
  const benchmark = JSON.parse(benchmarkRaw) as Benchmark;
  const runDirectory = path.resolve(protocol.parentRun);
  validateBenchmark(benchmark, protocol, runDirectory);

  const runRaw = await fs.readFile(path.join(runDirectory, "run.json"), "utf8");
  const run = JSON.parse(runRaw) as ExperimentRun;
  const configRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (run.status !== "prepared") throw new Error("Parent run must be prepared.");
  if (config.embedding.provider !== "google" || config.embedding.model !== "gemini-embedding-2" || config.embedding.outputDimensionality !== 1024) {
    throw new Error("Protocol requires the frozen Gemini Embedding 2 configuration at 1,024 dimensions.");
  }
  validateEvidence(benchmark.cases, chunks);
  validateDetection(benchmark.cases);

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const documents = await embedTextsWithCache(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), {
    provider: "google",
    model: config.embedding.model,
    taskType: config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT",
    outputDimensionality: config.embedding.outputDimensionality,
    titles: chunks.map((chunk) => chunk.title),
    batchSize: config.embedding.batchSize,
    priceUsdPerMillionTokens: config.embedding.pricing?.usdPerMillionInputTokens,
    allowProviderRequests: false,
  });
  const queries = await embedTextsWithCache(benchmark.cases.map((item) => item.question), {
    provider: "google",
    model: config.embedding.model,
    taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING",
    outputDimensionality: config.embedding.outputDimensionality,
    batchSize: config.embedding.batchSize,
    priceUsdPerMillionTokens: config.embedding.pricing?.usdPerMillionInputTokens,
    allowProviderRequests: options.allowProviderRequests,
  });

  const scoringStarted = performance.now();
  const rankings = benchmark.cases.map((_, caseIndex) => chunks
    .map((chunk, chunkIndex) => ({ ...chunk, score: cosineSimilarity(queries.vectors[caseIndex], documents.vectors[chunkIndex]) }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)));
  const variants = protocol.variants.map(({ id }) => evaluateVariant(id, benchmark.cases, rankings));
  const scoringMs = Math.round(performance.now() - scoringStarted);
  const selection = selectVariant(variants);
  const createdAt = new Date().toISOString();
  const artifact: Artifact = {
    schemaVersion: 1,
    id: protocol.id,
    attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17),
    createdAt,
    parentRunId: run.runId,
    hypothesis: protocol.hypothesis,
    split: "validation",
    testSplitTouched: false,
    inputHashes: { protocol: sha256(protocolRaw), benchmark: sha256(benchmarkRaw), config: sha256(configRaw), chunks: sha256(chunksRaw) },
    code: codeProvenance(),
    controls: { minScore: 0.68, topK: 4, embeddingProvider: "google", embeddingModel: config.embedding.model, outputDimensionality: 1024, reranker: null },
    cache: {
      documentHits: documents.cache.cacheHits,
      documentMisses: documents.cache.cacheMisses,
      queryHits: queries.cache.cacheHits,
      queryMisses: queries.cache.cacheMisses,
      apiInputs: documents.apiInputs + queries.apiInputs,
      apiRequests: documents.apiRequests + queries.apiRequests,
      estimatedApiTokens: documents.cache.estimatedApiTokens + queries.cache.estimatedApiTokens,
      estimatedApiCostUsd: (documents.cache.estimatedApiCostUsd ?? 0) + (queries.cache.estimatedApiCostUsd ?? 0),
    },
    timingsMs: { cosineScoring: scoringMs },
    detection: benchmark.cases.map((item) => ({ caseId: item.id, expectedLanguages: item.expectedLanguages, detectedLanguages: detectQueryMetadataConstraint(item.question)?.databaseLanguages ?? [] })),
    results: variants,
    selection,
    limitations: [
      "Eight focused answerable validation cases are not a general retrieval benchmark.",
      "Canonical chunk IDs are tied to the frozen 300-word parent corpus.",
      "The experiment does not recalibrate threshold 0.68 or measure unanswerable false positives.",
      "The locked 24-case test split remains untouched."
    ]
  };

  const attemptDirectory = path.join(runDirectory, "multi-technology-attempts", protocol.id, artifact.attemptId);
  await fs.mkdir(attemptDirectory, { recursive: true });
  await fs.writeFile(path.join(attemptDirectory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(attemptDirectory, "summary.md"), renderMarkdown(artifact));
  if (options.writeReport) await writeReport(protocol.reportOutput, artifact);
  console.log(`COMPLETED ${protocol.id}/${artifact.attemptId}`);
  for (const result of variants) {
    console.log(`${result.variant}: language-pairs=${format(result.metrics.bothLanguageCoverageAt4)}, evidence-pairs=${format(result.metrics.bothEvidenceSideCoverageAt4)}, evidence-side-recall=${format(result.metrics.meanEvidenceSideRecallAt4)}, side-MRR=${format(result.metrics.macroEvidenceSideMrr)}`);
  }
  console.log(`SELECTED ${selection.selectedVariant ?? "none"}: ${selection.reason}`);
  console.log(`CACHE documents=${documents.cache.cacheHits}/${chunks.length}, queries=${queries.cache.cacheHits}/${benchmark.cases.length}, apiInputs=${artifact.cache.apiInputs}, estimatedCost=$${artifact.cache.estimatedApiCostUsd.toFixed(8)}`);
}

function evaluateVariant(variant: VariantId, cases: BenchmarkCase[], rankings: ScoredChunk[][]): VariantResult {
  const evaluated = cases.map((testCase, index) => {
    const eligibleLanguages = variant === "legacy-first-technology" ? [testCase.legacyLanguage] : testCase.expectedLanguages;
    const eligible = rankings[index].filter((chunk) => chunk.language && eligibleLanguages.includes(chunk.language) && chunk.score >= 0.68);
    const selected = (variant === "multi-technology-balanced" ? balanceByLanguage(eligible) : eligible).slice(0, 4);
    return evaluateCase(testCase, selected);
  });
  const evidenceRrs = evaluated.flatMap((item) => Object.values(item.evidenceSideReciprocalRanks));
  return {
    variant,
    cases: evaluated,
    metrics: {
      bothLanguageCoverageAt4: mean(evaluated.map((item) => Number(item.bothLanguagesCovered))),
      meanLanguageSideCoverageAt4: mean(evaluated.map((item) => item.languageSideCoverage)),
      bothEvidenceSideCoverageAt4: mean(evaluated.map((item) => Number(item.bothEvidenceSidesCovered))),
      meanEvidenceSideRecallAt4: mean(evaluated.map((item) => item.evidenceSideRecall)),
      macroEvidenceSideMrr: mean(evidenceRrs),
      returnedChunks: evaluated.reduce((total, item) => total + item.retrieved.length, 0),
    }
  };
}

function balanceByLanguage(chunks: ScoredChunk[]) {
  const languageRanks = new Map<string, number>();
  return chunks.map((chunk) => {
    const language = chunk.language ?? "";
    const languageRank = (languageRanks.get(language) ?? 0) + 1;
    languageRanks.set(language, languageRank);
    return { chunk, languageRank };
  }).sort((left, right) => left.languageRank - right.languageRank || right.chunk.score - left.chunk.score || left.chunk.id.localeCompare(right.chunk.id)).map((item) => item.chunk);
}

function evaluateCase(testCase: BenchmarkCase, chunks: ScoredChunk[]): CaseResult {
  const representedLanguages = testCase.expectedLanguages.filter((language) => chunks.some((chunk) => chunk.language === language));
  const evidenceSideReciprocalRanks = Object.fromEntries(testCase.expectedLanguages.map((language) => {
    const target = testCase.evidenceByLanguage[language];
    const index = chunks.findIndex((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id));
    return [language, index < 0 ? 0 : 1 / (index + 1)];
  }));
  const evidenceLanguages = testCase.expectedLanguages.filter((language) => evidenceSideReciprocalRanks[language] > 0);
  return {
    caseId: testCase.id,
    expectedLanguages: testCase.expectedLanguages,
    detectedLanguages: detectQueryMetadataConstraint(testCase.question)?.databaseLanguages ?? [],
    retrieved: chunks.map((chunk, index) => ({ rank: index + 1, chunkId: chunk.id, sourceId: chunk.sourceId ?? null, language: chunk.language ?? null, section: chunk.section, score: chunk.score })),
    representedLanguages,
    evidenceLanguages,
    languageSideCoverage: representedLanguages.length / testCase.expectedLanguages.length,
    bothLanguagesCovered: representedLanguages.length === testCase.expectedLanguages.length,
    evidenceSideRecall: evidenceLanguages.length / testCase.expectedLanguages.length,
    bothEvidenceSidesCovered: evidenceLanguages.length === testCase.expectedLanguages.length,
    evidenceSideReciprocalRanks,
  };
}

function selectVariant(results: VariantResult[]) {
  const legacy = results.find((item) => item.variant === "legacy-first-technology");
  if (!legacy) throw new Error("Missing legacy variant.");
  const candidates = results.filter((item) => item.variant !== "legacy-first-technology" && item.cases.every((testCase) => sameSet(testCase.detectedLanguages, testCase.expectedLanguages)) && item.metrics.meanEvidenceSideRecallAt4 >= legacy.metrics.meanEvidenceSideRecallAt4 && item.metrics.macroEvidenceSideMrr >= legacy.metrics.macroEvidenceSideMrr);
  const selected = [...candidates].sort((left, right) => right.metrics.bothEvidenceSideCoverageAt4 - left.metrics.bothEvidenceSideCoverageAt4 || right.metrics.bothLanguageCoverageAt4 - left.metrics.bothLanguageCoverageAt4 || right.metrics.meanEvidenceSideRecallAt4 - left.metrics.meanEvidenceSideRecallAt4 || right.metrics.macroEvidenceSideMrr - left.metrics.macroEvidenceSideMrr || Number(right.variant === "multi-technology-unbalanced") - Number(left.variant === "multi-technology-unbalanced"))[0];
  return selected
    ? { selectedVariant: selected.variant, reason: "Selected by the preregistered validation rule." }
    : { selectedVariant: null, reason: "No multi-technology candidate satisfied the preregistered eligibility guardrails." };
}

function validateBenchmark(benchmark: Benchmark, protocol: Protocol, runDirectory: string) {
  if (benchmark.schemaVersion !== 1 || benchmark.split !== "validation" || benchmark.testSplitTouched !== false) throw new Error("Benchmark must be validation-only and leave the test untouched.");
  if (path.resolve(benchmark.parentRun) !== runDirectory || path.resolve(protocol.parentRun) !== runDirectory) throw new Error("Protocol and benchmark must reference the same parent run.");
  if (benchmark.cases.length !== 8 || new Set(benchmark.cases.map((item) => item.id)).size !== benchmark.cases.length) throw new Error("Benchmark must contain eight unique cases.");
  for (const item of benchmark.cases) {
    if (item.expectedLanguages.length !== 2 || new Set(item.expectedLanguages).size !== 2) throw new Error(`${item.id} must name exactly two expected languages.`);
    if (!item.expectedLanguages.includes(item.legacyLanguage)) throw new Error(`${item.id} has an invalid legacy language.`);
    if (!sameSet(Object.keys(item.evidenceByLanguage), item.expectedLanguages)) throw new Error(`${item.id} must provide evidence for both expected languages.`);
  }
}

function validateEvidence(cases: BenchmarkCase[], chunks: DocumentationChunk[]) {
  for (const item of cases) for (const language of item.expectedLanguages) {
    const target = item.evidenceByLanguage[language];
    const found = chunks.some((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id));
    if (!found) throw new Error(`${item.id} has no frozen canonical evidence for ${language}.`);
  }
}

function validateDetection(cases: BenchmarkCase[]) {
  for (const item of cases) {
    const detected = detectQueryMetadataConstraint(item.question)?.databaseLanguages ?? [];
    if (!sameSet(detected, item.expectedLanguages)) throw new Error(`${item.id} detected [${detected.join(", ")}] instead of [${item.expectedLanguages.join(", ")}].`);
  }
}

function validateProtocol(protocol: Protocol) {
  const expected: VariantId[] = ["legacy-first-technology", "multi-technology-unbalanced", "multi-technology-balanced"];
  if (protocol.schemaVersion !== 1 || protocol.split !== "validation" || !["preregistered", "completed"].includes(protocol.status)) throw new Error("Invalid validation protocol.");
  if (!sameSet(protocol.variants.map((item) => item.id), expected)) throw new Error("Protocol must declare all three variants exactly once.");
}

function renderMarkdown(artifact: Artifact) {
  return `# Comparative-query retrieval benchmark\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Parent run: \`${artifact.parentRunId}\`\n- Split: **validation only**; locked test touched: **${artifact.testSplitTouched ? "yes" : "no"}**\n- Hypothesis: ${artifact.hypothesis}\n- Evaluation commit: \`${artifact.code.gitCommit}\`${artifact.code.dirty ? " (dirty)" : ""}\n- Fixed retrieval: Gemini Embedding 2 (1,024d), cosine >= ${artifact.controls.minScore}, topK=${artifact.controls.topK}, no reranker\n- Query embedding provider inputs: **${artifact.cache.apiInputs}** in **${artifact.cache.apiRequests}** request(s), estimated cost **$${artifact.cache.estimatedApiCostUsd.toFixed(8)}**\n- Cosine scoring time: **${artifact.timingsMs.cosineScoring} ms**\n\n| Variant | Both languages @4 | Mean language-side coverage | Both canonical evidence sides @4 | Mean evidence-side recall | Macro side MRR | Returned chunks |\n|---|---:|---:|---:|---:|---:|---:|\n${artifact.results.map((item) => `| ${item.variant} | ${format(item.metrics.bothLanguageCoverageAt4)} | ${format(item.metrics.meanLanguageSideCoverageAt4)} | ${format(item.metrics.bothEvidenceSideCoverageAt4)} | ${format(item.metrics.meanEvidenceSideRecallAt4)} | ${format(item.metrics.macroEvidenceSideMrr)} | ${item.metrics.returnedChunks} |`).join("\n")}\n\n## Decision\n\n**${artifact.selection.selectedVariant ?? "No candidate selected"}.** ${artifact.selection.reason}\n\n## Per-case audit\n\n${artifact.results.map((variant) => `### ${variant.variant}\n\n| Case | Languages represented | Canonical evidence represented | Retrieved chunks |\n|---|---|---|---|\n${variant.cases.map((item) => `| ${item.caseId} | ${item.representedLanguages.join(" + ") || "none"} | ${item.evidenceLanguages.join(" + ") || "none"} | ${item.retrieved.map((chunk) => `${chunk.rank}:${chunk.language ?? "?"}/${chunk.chunkId}@${chunk.score.toFixed(4)}`).join("; ") || "none"} |`).join("\n")}`).join("\n\n")}\n\n## Scope and limitations\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

async function writeReport(output: string, artifact: Artifact) {
  const base = path.resolve(output);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(`${base}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${base}.md`, renderMarkdown(artifact));
  const rows = artifact.results.map((item) => [item.variant, item.metrics.bothLanguageCoverageAt4, item.metrics.meanLanguageSideCoverageAt4, item.metrics.bothEvidenceSideCoverageAt4, item.metrics.meanEvidenceSideRecallAt4, item.metrics.macroEvidenceSideMrr, item.metrics.returnedChunks]);
  await fs.writeFile(`${base}.csv`, [["variant", "both_language_coverage_at_4", "mean_language_side_coverage_at_4", "both_evidence_side_coverage_at_4", "mean_evidence_side_recall_at_4", "macro_evidence_side_mrr", "returned_chunks"], ...rows].map((row) => row.join(",")).join("\n") + "\n");
}

function codeProvenance() {
  const paths = ["src", "scripts", "package.json", "package-lock.json", "docs/evaluation", "docs/experiments"];
  const status = runCommand("git", ["status", "--porcelain", "--", ...paths]);
  const diff = runCommand("git", ["diff", "--binary", "--", ...paths]);
  return { gitCommit: runCommand("git", ["rev-parse", "HEAD"]) || "unknown", dirty: Boolean(status), gitDiffHash: sha256(diff) };
}

function sameSet(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((item) => rightSet.has(item));
}
function mean(values: number[]) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number) { return value.toFixed(4); }
function runCommand(command: string, args: string[]) { const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true }); return result.status === 0 ? result.stdout.trim() : ""; }
function parseArgs(args: string[]) {
  const value = (name: string, fallback: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  return { protocol: value("--protocol", "docs/experiments/multi-technology-retrieval.v1.json"), allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report") };
}

main().catch((error) => { console.error(error); process.exit(1); });
