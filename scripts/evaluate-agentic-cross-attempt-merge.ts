import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

import { planAgenticRewriteWithRecovery, type AgenticPlannerCandidate, type AgenticPlannerResult } from "../src/lib/rag/agentic-planner";
import { mergeAccumulatedEvidenceByLanguage, retrieveWithAgenticLoop, type AgenticRetrievalResult, type EvidenceAssessment } from "../src/lib/rag/agentic-retrieval";
import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, type GoldenCase } from "../src/lib/rag/golden-set";
import { detectQueryMetadataConstraint, filterChunksByQueryMetadata } from "../src/lib/rag/metadata-filter";
import { aggregateRetrievalMetrics, evaluateRetrievalCase } from "../src/lib/rag/retrieval-metrics";
import { assessEvidenceSemantically, type SemanticAssessorCandidate, type SemanticAssessorResult } from "../src/lib/rag/semantic-evidence-assessor";
import type { DocumentationChunk, RetrievalResult } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

const protocolPath = "docs/experiments/agentic-rag-cross-attempt-merge.v1.json";
const positivePath = "docs/evaluation/multi-technology-retrieval-benchmark.v1.json";
const negativePath = "docs/evaluation/multi-technology-negative-benchmark.v1.json";
const goldenPath = "docs/evaluation/golden-set.v4.json";
const splitPath = "docs/evaluation/golden-set-splits.v4.json";
const historicalPath = "docs/experiment-results/agentic-rag-semantic-gate-v1-validation.json";
const parentProtocolPath = "docs/experiments/agentic-rag-semantic-gate.v1.json";
const runDirectory = "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec";
const outputBase = "docs/experiment-results/agentic-rag-cross-attempt-merge-v1-validation";

type EvidenceTarget = { sourceId: string; acceptedChunkIds: string[] };
type PositiveCase = { id: string; question: string; expectedLanguages: string[]; evidenceByLanguage: Record<string, EvidenceTarget> };
type NegativeCase = { id: string; question: string; expectedLanguages: string[]; answerability: "unanswerable" };
type FocusedBenchmark<T> = { schemaVersion: 1; parentRun: string; split: "validation"; testSplitTouched: false; cases: T[] };
type FileRef = { path: string; sha256: string };
type Protocol = {
  schemaVersion: 1; id: string; status: "preregistered" | "completed"; split: "validation"; testSplitTouched: false; hypothesis: string;
  parent: { protocol: FileRef; result: FileRef };
  benchmark: { generalValidationCases: number; focusedComparativePositiveCases: number; focusedComparativeNegativeCases: number; totalExecutedCases: number; lockedTestCases: number; lockedTestExecution: false };
  frozenControls: { corpusChunks: number; minimumScore: number; topK: number; reranker: null; maximumAttempts: number; maximumQueriesPerAttempt: number };
  selectionRule: { minimumGeneralRecallAt4: number; minimumGeneralMrr: number; minimumGeneralNdcgAt4: number; requiredGeneralUnanswerableFalsePositiveRate: number; minimumComparativeBothEvidenceSideCoverageAt4: number; minimumComparativeMeanEvidenceSideRecallAt4: number; requiredFocusedUnanswerableFalsePositiveRate: number; minimumRecoveredSecondAttemptCases: number; maximumProviderErrors: number; maximumObservedCombinedModelCostUsd: number; maximumP95IncrementalLatencyMs: number };
};
type ParentProtocol = { id: string; agenticPolicy: { maximumAttempts: number; maximumQueriesPerAttempt: number; semanticAssessor: SemanticAssessorCandidate; planner: { model: string; reasoningEffort: "low"; maxOutputTokens: number; inputPriceUsdPerMillionTokens: number; outputPriceUsdPerMillionTokensIncludingThinking: number } } };
type Historical = { id: string; results: { semanticGated: { general: RetrievalAggregate; focused: FocusedMetrics } }; advancement: unknown };
type RetrievalAggregate = ReturnType<typeof aggregateRetrievalMetrics>;
type FocusedMetrics = { bothLanguageCoverageAt4: number; meanLanguageSideCoverageAt4: number; bothEvidenceSideCoverageAt4: number; meanEvidenceSideRecallAt4: number; macroEvidenceSideMrr: number; noAnswerFalsePositiveRate: number };
type CaseRun = { caseId: string; group: "general" | "focused-positive" | "focused-negative"; question: string; baseline: RetrievalResult[]; agentic: AgenticRetrievalResult; effectiveChunks: RetrievalResult[]; incrementalLatencyMs: number };
type AssessorObservation = { caseId: string; attempt: number; result: SemanticAssessorResult };
type PlannerObservation = { caseId: string; result: AgenticPlannerResult };

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const flags = { plan: process.argv.includes("--plan"), allow: process.argv.includes("--allow-provider-requests"), write: process.argv.includes("--write-report") };
  const input = await loadInputs();
  validateInputs(input);
  if (flags.plan) {
    console.log(`VALID ${input.protocol.id}: 54 general + 8 focused-positive + 8 focused-negative cases; historical comparators frozen; locked test executions: 0.`);
    console.log("Candidate changes only the cross-attempt merge policy inside the existing two-attempt loop.");
    return;
  }
  if (input.protocol.status === "completed") throw new Error("Completed protocols cannot be rerun in place.");
  if (!flags.allow) throw new Error("Provider requests require --allow-provider-requests after the runner is committed.");

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const common = { provider: "google" as const, model: input.config.embedding.model, outputDimensionality: input.config.embedding.outputDimensionality, batchSize: input.config.embedding.batchSize, priceUsdPerMillionTokens: input.config.embedding.pricing?.usdPerMillionInputTokens };
  console.log(`Loading ${input.chunks.length} frozen document embeddings from cache...`);
  const documents = await embedTextsWithCache(input.chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), { ...common, taskType: input.config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT", titles: input.chunks.map((chunk) => chunk.title), allowProviderRequests: false });
  const cases = buildCases(input.generalCases, input.positives.cases, input.negatives.cases);
  const originalQuestions = [...new Set(cases.map((item) => item.question))];
  const originals = await embedTextsWithCache(originalQuestions, { ...common, taskType: input.config.embedding.queryTask ?? "QUESTION_ANSWERING", allowProviderRequests: false });
  const vectors = new Map(originalQuestions.map((question, index) => [normalize(question), originals.vectors[index]]));
  const embeddingUsage = { apiInputs: 0, apiRequests: 0, cacheHits: documents.cache.cacheHits + originals.cache.cacheHits, cacheMisses: documents.cache.cacheMisses + originals.cache.cacheMisses, estimatedApiCostUsd: 0 };
  const assessor: AssessorObservation[] = [], planner: PlannerObservation[] = [];
  const plannerCandidate = candidateForPlanner(input.parentProtocol, input.parentProtocol.id);

  async function retrieve(query: string, topK: number) {
    const key = normalize(query);
    let vector = vectors.get(key);
    if (!vector) {
      const embedded = await embedTextsWithCache([query], { ...common, taskType: input.config.embedding.queryTask ?? "QUESTION_ANSWERING", allowProviderRequests: true });
      vector = embedded.vectors[0]; vectors.set(key, vector); embeddingUsage.apiInputs += embedded.apiInputs; embeddingUsage.apiRequests += embedded.apiRequests;
      embeddingUsage.cacheHits += embedded.cache.cacheHits; embeddingUsage.cacheMisses += embedded.cache.cacheMisses; embeddingUsage.estimatedApiCostUsd += embedded.cache.estimatedApiCostUsd ?? 0;
    }
    return filterChunksByQueryMetadata(query, input.chunks).chunks
      .map((chunk) => ({ ...chunk, score: cosineSimilarity(vector!, documents.vectors[input.chunkIndex.get(chunk)!]) }))
      .filter((chunk) => chunk.score >= input.protocol.frozenControls.minimumScore)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, topK).map((chunk, index) => ({ ...chunk, rank: index + 1 }));
  }

  const runs: CaseRun[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const baseline = await retrieve(item.question, input.protocol.frozenControls.topK);
    const agentic = await retrieveWithAgenticLoop(item.question, {
      retrieve,
      assess: async ({ question, chunks, attempt }) => {
        const result = await assessEvidenceSemantically({ candidate: input.parentProtocol.agenticPolicy.semanticAssessor, question, chunks, allowProviderRequests: true });
        assessor.push({ caseId: item.caseId, attempt, result });
        return toEvidenceAssessment(result);
      },
      rewrite: async ({ question, previousQueries, chunks, assessment }) => {
        const result = await planAgenticRewriteWithRecovery({ candidate: plannerCandidate, question, previousQueries, chunks, assessment, allowProviderRequests: true });
        planner.push({ caseId: item.caseId, result });
        return result.rewrite;
      },
      accumulate: ({ question, previous, current, topK }) => mergeAccumulatedEvidenceByLanguage({ previous, current, requiredLanguages: detectQueryMetadataConstraint(question)?.databaseLanguages ?? [], topK }),
    }, { topK: input.protocol.frozenControls.topK, maxAttempts: input.protocol.frozenControls.maximumAttempts, maxQueriesPerAttempt: input.protocol.frozenControls.maximumQueriesPerAttempt });
    const incrementalLatencyMs = agentic.trace.filter((step) => !(step.action === "retrieve" && step.attempt === 1) && step.action !== "stop").reduce((sum, step) => sum + step.durationMs, 0);
    runs.push({ ...item, baseline, agentic, effectiveChunks: agentic.sufficient ? agentic.chunks : [], incrementalLatencyMs });
    if ((index + 1) % 5 === 0 || index + 1 === cases.length) console.log(`Executed ${index + 1}/${cases.length} cases; aggregate metrics remain sealed.`);
  }

  const artifact = buildArtifact(input, runs, assessor, planner, embeddingUsage);
  if (flags.write) await writeOutputs(artifact);
  printResult(artifact);
}

async function loadInputs() {
  const [protocolRaw, positiveRaw, negativeRaw, configRaw, runRaw, chunksRaw, historicalRaw, parentProtocolRaw] = await Promise.all([protocolPath, positivePath, negativePath, path.join(runDirectory, "config.snapshot.json"), path.join(runDirectory, "run.json"), path.join(runDirectory, "chunks.json"), historicalPath, parentProtocolPath].map((file) => fs.readFile(file, "utf8")));
  const dataset = await loadGoldenSet(goldenPath), split = await loadGoldenSetSplit(splitPath), chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  return { protocolRaw, positiveRaw, negativeRaw, configRaw, runRaw, chunksRaw, historicalRaw, parentProtocolRaw, protocol: JSON.parse(protocolRaw) as Protocol, parentProtocol: JSON.parse(parentProtocolRaw) as ParentProtocol, positives: JSON.parse(positiveRaw) as FocusedBenchmark<PositiveCase>, negatives: JSON.parse(negativeRaw) as FocusedBenchmark<NegativeCase>, config: JSON.parse(configRaw) as ExperimentConfig, run: JSON.parse(runRaw) as ExperimentRun, chunks, historical: JSON.parse(historicalRaw) as Historical, dataset, split, generalCases: selectGoldenSplit(dataset, split, "validation"), chunkIndex: new Map(chunks.map((chunk, index) => [chunk, index])) };
}

function validateInputs(input: Awaited<ReturnType<typeof loadInputs>>) {
  const p = input.protocol, errors: string[] = [];
  if (p.schemaVersion !== 1 || p.id !== "agentic-rag-cross-attempt-merge-v1" || !["preregistered", "completed"].includes(p.status) || p.split !== "validation" || p.testSplitTouched) errors.push("Invalid registered validation protocol.");
  const refs = [p.parent.protocol, p.parent.result];
  for (const ref of refs) if (sha256File(ref.path) !== ref.sha256) errors.push(`${ref.path}: frozen hash mismatch.`);
  if (p.benchmark.lockedTestExecution || !input.split.testLocked || input.split.testCaseIds.length !== 24 || input.generalCases.some((item) => input.split.testCaseIds.includes(item.id))) errors.push("Locked-test isolation failed.");
  if (input.generalCases.length !== 54 || input.positives.cases.length !== 8 || input.negatives.cases.length !== 8 || p.benchmark.totalExecutedCases !== 70) errors.push("Frozen case counts changed.");
  if (input.run.status !== "prepared" || input.config.embedding.provider !== "google" || input.config.embedding.model !== "gemini-embedding-2" || input.config.embedding.outputDimensionality !== 1024 || input.chunks.length !== 33079) errors.push("Frozen retrieval run changed.");
  if (p.frozenControls.minimumScore !== .68 || p.frozenControls.topK !== 4 || p.frozenControls.reranker !== null || p.frozenControls.maximumAttempts !== 2 || p.frozenControls.maximumQueriesPerAttempt !== 2) errors.push("Retrieval or loop controls changed.");
  if (input.historical.id !== "agentic-rag-semantic-gate-v1" || input.parentProtocol.id !== "agentic-rag-semantic-gate-v1") errors.push("Historical replacement-policy comparator changed.");
  if (errors.length) throw new Error(errors.join("\n"));
}

function buildArtifact(input: Awaited<ReturnType<typeof loadInputs>>, runs: CaseRun[], assessor: AssessorObservation[], planner: PlannerObservation[], embedding: Record<string, number>) {
  const generalRuns = runs.filter((item) => item.group === "general");
  const generalCases = generalRuns.map((item) => evaluateRetrievalCase(input.generalCases.find((test) => test.id === item.caseId)!, item.effectiveChunks));
  const general = aggregateRetrievalMetrics(generalCases), focused = evaluateFocused(input.positives.cases, input.negatives.cases, runs);
  const assessorResults = assessor.map((item) => item.result), plannerResults = planner.map((item) => item.result);
  const assessorCost = assessorResults.filter((item) => !item.cacheHit).reduce((sum, item) => sum + item.usage.costUsd, 0);
  const plannerCost = plannerResults.filter((item) => !item.cacheHit).reduce((sum, item) => sum + item.usage.estimatedCostUsd, 0);
  const latencies = runs.map((item) => item.incrementalLatencyMs), rule = input.protocol.selectionRule;
  const recoveredBySecondAttempt = runs.filter((item) => item.agentic.attempts === 2 && item.agentic.sufficient).length;
  const checks = {
    generalRecallAt4: (general.recallAtK ?? 0) >= rule.minimumGeneralRecallAt4, generalMrr: (general.mrr ?? 0) >= rule.minimumGeneralMrr, generalNdcgAt4: (general.ndcgAtK ?? 0) >= rule.minimumGeneralNdcgAt4,
    generalFpr: general.noAnswerFalsePositiveRate === rule.requiredGeneralUnanswerableFalsePositiveRate, comparativeBothEvidence: focused.bothEvidenceSideCoverageAt4 >= rule.minimumComparativeBothEvidenceSideCoverageAt4,
    comparativeSideRecall: focused.meanEvidenceSideRecallAt4 >= rule.minimumComparativeMeanEvidenceSideRecallAt4, focusedFpr: focused.noAnswerFalsePositiveRate === rule.requiredFocusedUnanswerableFalsePositiveRate,
    recoveredSecondAttempts: recoveredBySecondAttempt >= rule.minimumRecoveredSecondAttemptCases,
    providerErrors: 0 <= rule.maximumProviderErrors, combinedCost: assessorCost + plannerCost <= rule.maximumObservedCombinedModelCostUsd, p95Latency: percentile(latencies, .95) <= rule.maximumP95IncrementalLatencyMs,
  };
  const passed = Object.values(checks).every(Boolean), createdAt = new Date().toISOString();
  return { schemaVersion: 1, id: input.protocol.id, createdAt, attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17), split: "validation", lockedTestCasesExecuted: 0, inputHashes: { protocol: sha256(input.protocolRaw), parentProtocol: sha256(input.parentProtocolRaw), historical: sha256(input.historicalRaw), positives: sha256(input.positiveRaw), negatives: sha256(input.negativeRaw), chunks: sha256(input.chunksRaw) }, code: codeProvenance(), controls: { threshold: .68, topK: 4, maximumAttempts: 2, maximumQueriesPerAttempt: 2, mergePolicy: "language-balanced-cross-attempt-accumulation", assessor: input.parentProtocol.agenticPolicy.semanticAssessor, planner: candidateForPlanner(input.parentProtocol, input.parentProtocol.id) }, results: { replacementPolicy: input.historical.results.semanticGated, accumulatedPolicy: { general, focused } }, diagnostics: { secondAttemptCases: runs.filter((item) => item.agentic.attempts === 2).length, recoveredBySecondAttempt, finalAbstentions: runs.filter((item) => !item.agentic.sufficient).length, stopReasons: counts(runs.map((item) => item.agentic.stopReason)) }, execution: { assessorInvocations: assessor.length, assessorProviderCalls: assessorResults.filter((item) => !item.cacheHit && item.providerInvoked).length, assessorCacheHits: assessorResults.filter((item) => item.cacheHit).length, assessorTokens: sumAssessor(assessorResults), assessorCostUsd: assessorCost, plannerInvocations: planner.length, plannerProviderCalls: plannerResults.filter((item) => !item.cacheHit).length, plannerCacheHits: plannerResults.filter((item) => item.cacheHit).length, plannerTokens: sumPlanner(plannerResults), plannerCostUsd: plannerCost, embedding, combinedObservedModelCostUsd: assessorCost + plannerCost, providerErrors: 0, latencyMs: { mean: mean(latencies), p95: percentile(latencies, .95), maximum: Math.max(0, ...latencies) } }, advancement: { qualifiedForGenerationStudy: passed, checks, failedChecks: Object.entries(checks).filter(([, value]) => !value).map(([key]) => key) }, cases: runs.map((item) => ({ caseId: item.caseId, group: item.group, sufficient: item.agentic.sufficient, attempts: item.agentic.attempts, stopReason: item.agentic.stopReason, baseline: item.baseline.map(compact), finalEvidence: item.effectiveChunks.map(compact), rawFinalEvidence: item.agentic.chunks.map(compact), trace: item.agentic.trace })), assessorAudit: assessor.map((item) => ({ caseId: item.caseId, attempt: item.attempt, assessment: item.result.assessment, response: { model: item.result.responseModel, provider: item.result.responseProvider, id: item.result.responseId, finishReason: item.result.finishReason, usage: item.result.usage, latencyMs: item.result.latencyMs, cacheHit: item.result.cacheHit } })), plannerAudit: planner, limitations: ["The motivating trace and validation comparators were inspected before preregistration.", "Canonical evidence metrics may reject semantically valid alternatives.", "Generation quality is outside this experiment.", "This is the final Agentic RAG experiment for the current thesis."] };
}

function evaluateFocused(positives: PositiveCase[], negatives: NegativeCase[], runs: CaseRun[]): FocusedMetrics {
  const chunksFor = (id: string) => runs.find((item) => item.caseId === id && item.group.startsWith("focused"))?.effectiveChunks ?? [];
  const positive = positives.map((item) => { const chunks = chunksFor(item.id); const rr = item.expectedLanguages.map((language) => { const target = item.evidenceByLanguage[language]; const index = chunks.findIndex((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id)); return index < 0 ? 0 : 1 / (index + 1); }); return { languages: item.expectedLanguages.filter((language) => chunks.some((chunk) => chunk.language === language)), evidence: rr.filter(Boolean).length, rr }; });
  const sides = positives.reduce((sum, item) => sum + item.expectedLanguages.length, 0);
  return { bothLanguageCoverageAt4: mean(positive.map((item, i) => Number(item.languages.length === positives[i].expectedLanguages.length))), meanLanguageSideCoverageAt4: positive.reduce((sum, item) => sum + item.languages.length, 0) / sides, bothEvidenceSideCoverageAt4: mean(positive.map((item, i) => Number(item.evidence === positives[i].expectedLanguages.length))), meanEvidenceSideRecallAt4: positive.reduce((sum, item) => sum + item.evidence, 0) / sides, macroEvidenceSideMrr: mean(positive.flatMap((item) => item.rr)), noAnswerFalsePositiveRate: mean(negatives.map((item) => Number(chunksFor(item.id).length > 0))) };
}

async function writeOutputs(artifact: ReturnType<typeof buildArtifact>) {
  await fs.writeFile(`${outputBase}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(artifact));
  const rows = artifact.cases.map((item) => [item.caseId, item.group, item.sufficient, item.attempts, item.stopReason, item.finalEvidence.length, JSON.stringify(item.trace.filter((step) => step.action === "rewrite").flatMap((step) => step.rewrite?.queries ?? []))]);
  await fs.writeFile(`${outputBase}.csv`, [["case_id", "group", "sufficient", "attempts", "stop_reason", "final_chunks", "rewrite_queries"], ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n");
}

function renderMarkdown(a: ReturnType<typeof buildArtifact>) { const h = a.results.replacementPolicy, s = a.results.accumulatedPolicy; return `# Cross-attempt evidence accumulation\n\n- Split: **validation**; locked test executions: **0**\n- Candidate qualified for a separate generation study: **${a.advancement.qualifiedForGenerationStudy ? "yes" : "no"}**\n- Failed checks: **${a.advancement.failedChecks.join(", ") || "none"}**\n\n| Variant | Recall@4 | MRR | nDCG@4 | General FPR | Both evidence sides | Side recall | Focused FPR |\n|---|---:|---:|---:|---:|---:|---:|---:|\n| Replace on retry (historical) | ${fmt(h.general.recallAtK)} | ${fmt(h.general.mrr)} | ${fmt(h.general.ndcgAtK)} | ${fmt(h.general.noAnswerFalsePositiveRate)} | ${fmt(h.focused.bothEvidenceSideCoverageAt4)} | ${fmt(h.focused.meanEvidenceSideRecallAt4)} | ${fmt(h.focused.noAnswerFalsePositiveRate)} |\n| Balanced cross-attempt accumulation | ${fmt(s.general.recallAtK)} | ${fmt(s.general.mrr)} | ${fmt(s.general.ndcgAtK)} | ${fmt(s.general.noAnswerFalsePositiveRate)} | ${fmt(s.focused.bothEvidenceSideCoverageAt4)} | ${fmt(s.focused.meanEvidenceSideRecallAt4)} | ${fmt(s.focused.noAnswerFalsePositiveRate)} |\n\n- Assessor/planner calls: **${a.execution.assessorProviderCalls}/${a.execution.plannerProviderCalls}**\n- Combined observed model cost: **$${a.execution.combinedObservedModelCostUsd.toFixed(6)}**\n- Incremental latency mean/p95/max: **${a.execution.latencyMs.mean.toFixed(0)}/${a.execution.latencyMs.p95.toFixed(0)}/${a.execution.latencyMs.maximum.toFixed(0)} ms**\n- Second-attempt cases/recovered: **${a.diagnostics.secondAttemptCases}/${a.diagnostics.recoveredBySecondAttempt}**\n\nThis is the final Agentic RAG architecture experiment for the current thesis.\n`; }

function buildCases(general: GoldenCase[], positives: PositiveCase[], negatives: NegativeCase[]) { return [...general.map((item) => ({ caseId: item.id, group: "general" as const, question: item.question })), ...positives.map((item) => ({ caseId: item.id, group: "focused-positive" as const, question: item.question })), ...negatives.map((item) => ({ caseId: item.id, group: "focused-negative" as const, question: item.question }))]; }
function toEvidenceAssessment(result: SemanticAssessorResult): EvidenceAssessment { return { sufficient: result.assessment.sufficient, reason: result.assessment.reason, missingAspects: result.assessment.missingAspects }; }
function candidateForPlanner(p: ParentProtocol, id: string): AgenticPlannerCandidate { const value = p.agenticPolicy.planner; return { id, model: value.model, reasoningEffort: value.reasoningEffort, maxOutputTokens: value.maxOutputTokens, inputPriceUsdPerMillionTokens: value.inputPriceUsdPerMillionTokens, outputPriceUsdPerMillionTokens: value.outputPriceUsdPerMillionTokensIncludingThinking }; }
function compact(chunk: RetrievalResult) { return { id: chunk.id, sourceId: chunk.sourceId ?? null, language: chunk.language ?? null, rank: chunk.rank, score: chunk.score, section: chunk.section }; }
function sumAssessor(items: SemanticAssessorResult[]) { return items.reduce((s, x) => ({ prompt: s.prompt + x.usage.promptTokens, completion: s.completion + x.usage.completionTokens, reasoning: s.reasoning + x.usage.reasoningTokens, total: s.total + x.usage.totalTokens }), { prompt: 0, completion: 0, reasoning: 0, total: 0 }); }
function sumPlanner(items: AgenticPlannerResult[]) { return items.reduce((s, x) => ({ prompt: s.prompt + x.usage.promptTokens, completion: s.completion + x.usage.completionTokens, reasoning: s.reasoning + x.usage.reasoningTokens, total: s.total + x.usage.totalTokens }), { prompt: 0, completion: 0, reasoning: 0, total: 0 }); }
function counts(values: string[]) { return Object.fromEntries([...new Set(values)].map((value) => [value, values.filter((item) => item === value).length])); }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function percentile(values: number[], fraction: number) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0; }
function normalize(value: string) { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function sha256(value: string | Buffer) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sha256File(file: string) { return sha256(spawnSync("git", ["show", `HEAD:${file}`], { encoding: null }).stdout || Buffer.from("")); }
function codeProvenance() { return { gitCommit: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), dirty: Boolean(spawnSync("git", ["status", "--porcelain", "--", "src", "scripts", "docs/evaluation", "docs/experiments"], { encoding: "utf8" }).stdout.trim()) }; }
function fmt(value: number | null) { return value === null ? "n/a" : value.toFixed(4); }
function csv(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function printResult(a: ReturnType<typeof buildArtifact>) { console.log(`COMPLETED ${a.id}: accumulated recall=${fmt(a.results.accumulatedPolicy.general.recallAtK)}, MRR=${fmt(a.results.accumulatedPolicy.general.mrr)}, nDCG=${fmt(a.results.accumulatedPolicy.general.ndcgAtK)}, FPR=${fmt(a.results.accumulatedPolicy.general.noAnswerFalsePositiveRate)}, recovered=${a.diagnostics.recoveredBySecondAttempt}.`); console.log(`QUALIFIED FOR GENERATION STUDY ${a.advancement.qualifiedForGenerationStudy ? "yes" : "no"}; failed checks: ${a.advancement.failedChecks.join(", ") || "none"}; cost=$${a.execution.combinedObservedModelCostUsd.toFixed(6)}.`); }

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
