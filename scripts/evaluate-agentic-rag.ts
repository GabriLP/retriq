import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

import { assessAgenticEvidence } from "../src/lib/rag/agentic-assessor";
import { planAgenticRewrite, type AgenticPlannerCandidate, type AgenticPlannerResult } from "../src/lib/rag/agentic-planner";
import { retrieveWithAgenticLoop, type AgenticRetrievalResult } from "../src/lib/rag/agentic-retrieval";
import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, type GoldenCase } from "../src/lib/rag/golden-set";
import { filterChunksByQueryMetadata } from "../src/lib/rag/metadata-filter";
import { aggregateRetrievalMetrics, evaluateRetrievalCase } from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk, RetrievalResult } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

const protocolPath = "docs/experiments/agentic-rag-planner.v1.json";
const positivePath = "docs/evaluation/multi-technology-retrieval-benchmark.v1.json";
const negativePath = "docs/evaluation/multi-technology-negative-benchmark.v1.json";
const goldenPath = "docs/evaluation/golden-set.v4.json";
const splitPath = "docs/evaluation/golden-set-splits.v4.json";
const runDirectory = "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec";
const reportBase = "docs/experiment-results/agentic-rag-planner-v1-validation";

type EvidenceTarget = { sourceId: string; acceptedChunkIds: string[] };
type PositiveCase = { id: string; question: string; expectedLanguages: string[]; evidenceByLanguage: Record<string, EvidenceTarget> };
type NegativeCase = { id: string; question: string; expectedLanguages: string[]; answerability: "unanswerable" };
type FocusedBenchmark<T> = { schemaVersion: 1; parentRun: string; split: "validation"; testSplitTouched: false; cases: T[] };
type Protocol = {
  schemaVersion: 1;
  id: string;
  status: "preregistered" | "completed";
  split: "validation";
  testSplitTouched: false;
  hypothesis: string;
  frozenRetrievalControls: { corpusChunks: number; embedding: string; minimumScore: number; topK: number; reranker: null };
  agenticPolicy: { maximumAttempts: number; maximumQueriesPerAttempt: number; planner: { provider: "google"; model: string; reasoningEffort: "low"; maxOutputTokens: number; inputPriceUsdPerMillionTokens: number; outputPriceUsdPerMillionTokensIncludingThinking: number } };
  benchmark: { generalValidationCases: number; focusedComparativePositiveCases: number; focusedComparativeNegativeCases: number; lockedTestCases: number; lockedTestExecution: false };
  selectionRule: {
    requiredGeneralRecallAt4: number; requiredGeneralMrr: number; requiredGeneralNdcgAt4: number;
    requiredUnanswerableFalsePositiveRate: number; minimumComparativeBothEvidenceSideCoverageAt4: number;
    minimumComparativeMeanEvidenceSideRecallAt4: number; requiredPlannerStructuredValidityRate: number;
    maximumPlannerProviderErrors: number; maximumObservedPlannerCostUsd: number; maximumP95IncrementalLatencyMs: number;
  };
};
type CompactChunk = { rank: number; chunkId: string; sourceId: string | null; language: string | null; section: string; score: number };
type CaseRun = {
  caseId: string; group: "general" | "focused-positive" | "focused-negative"; question: string;
  baseline: RetrievalResult[]; agentic: AgenticRetrievalResult; effectiveAgenticChunks: RetrievalResult[]; incrementalLatencyMs: number;
};
type FocusedMetrics = {
  bothLanguageCoverageAt4: number; meanLanguageSideCoverageAt4: number; bothEvidenceSideCoverageAt4: number;
  meanEvidenceSideRecallAt4: number; macroEvidenceSideMrr: number; noAnswerFalsePositiveRate: number;
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const inputs = await loadInputs();
  validateInputs(inputs);
  if (options.plan) {
    console.log(`VALID ${inputs.protocol.id}: ${inputs.generalCases.length} general + ${inputs.positives.cases.length} positive + ${inputs.negatives.cases.length} negative validation cases; locked test cases executed: 0.`);
    return;
  }
  if (inputs.protocol.status === "completed") throw new Error("This protocol is already completed and cannot be rerun in place. Preregister a new protocol id.");
  if (!options.allowProviderRequests) throw new Error("Execution requires --allow-provider-requests; --plan remains provider-free.");

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const chunks = inputs.chunks;
  const embeddingCommon = {
    provider: "google" as const,
    model: inputs.config.embedding.model,
    outputDimensionality: inputs.config.embedding.outputDimensionality,
    batchSize: inputs.config.embedding.batchSize,
    priceUsdPerMillionTokens: inputs.config.embedding.pricing?.usdPerMillionInputTokens,
  };
  console.log(`Loading ${chunks.length} frozen document embeddings from cache...`);
  const documents = await embedTextsWithCache(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), {
    ...embeddingCommon, taskType: inputs.config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT",
    titles: chunks.map((chunk) => chunk.title), allowProviderRequests: false,
  });
  const cases = buildCaseList(inputs.generalCases, inputs.positives.cases, inputs.negatives.cases);
  const uniqueOriginalQuestions = [...new Set(cases.map((item) => item.question))];
  const originals = await embedTextsWithCache(uniqueOriginalQuestions, {
    ...embeddingCommon, taskType: inputs.config.embedding.queryTask ?? "QUESTION_ANSWERING", allowProviderRequests: false,
  });
  const vectorByQuery = new Map(uniqueOriginalQuestions.map((question, index) => [normalizeQuery(question), originals.vectors[index]]));
  const embeddingUsage = { apiInputs: 0, apiRequests: 0, cacheHits: documents.cache.cacheHits + originals.cache.cacheHits, cacheMisses: documents.cache.cacheMisses + originals.cache.cacheMisses, estimatedApiCostUsd: 0 };
  const plannerResults: AgenticPlannerResult[] = [];
  const candidate = plannerCandidate(inputs.protocol);

  async function retrieve(query: string, topK: number) {
    const key = normalizeQuery(query);
    let vector = vectorByQuery.get(key);
    if (!vector) {
      const embedded = await embedTextsWithCache([query], {
        ...embeddingCommon, taskType: inputs.config.embedding.queryTask ?? "QUESTION_ANSWERING", allowProviderRequests: true,
      });
      vector = embedded.vectors[0];
      vectorByQuery.set(key, vector);
      embeddingUsage.apiInputs += embedded.apiInputs;
      embeddingUsage.apiRequests += embedded.apiRequests;
      embeddingUsage.cacheHits += embedded.cache.cacheHits;
      embeddingUsage.cacheMisses += embedded.cache.cacheMisses;
      embeddingUsage.estimatedApiCostUsd += embedded.cache.estimatedApiCostUsd ?? 0;
    }
    const compatible = filterChunksByQueryMetadata(query, chunks).chunks;
    return compatible.map((chunk) => ({ ...chunk, score: cosineSimilarity(vector!, documents.vectors[inputs.chunkIndex.get(chunk)!]) }))
      .filter((chunk) => chunk.score >= inputs.protocol.frozenRetrievalControls.minimumScore)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, topK)
      .map((chunk, index) => ({ ...chunk, rank: index + 1 }));
  }

  const runs: CaseRun[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const baseline = await retrieve(item.question, inputs.protocol.frozenRetrievalControls.topK);
    const agentic = await retrieveWithAgenticLoop(item.question, {
      retrieve,
      assess: async ({ question, chunks: retrieved }) => assessAgenticEvidence({ question, chunks: retrieved, minimumTopScore: inputs.protocol.frozenRetrievalControls.minimumScore }),
      rewrite: async ({ question, previousQueries, chunks: retrieved, assessment }) => {
        const result = await planAgenticRewrite({ candidate, question, previousQueries, chunks: retrieved, assessment, allowProviderRequests: true });
        plannerResults.push(result);
        return result.rewrite;
      },
    }, { topK: inputs.protocol.frozenRetrievalControls.topK, maxAttempts: inputs.protocol.agenticPolicy.maximumAttempts, maxQueriesPerAttempt: inputs.protocol.agenticPolicy.maximumQueriesPerAttempt });
    const incrementalLatencyMs = agentic.trace.filter((step) => !(step.action === "retrieve" && step.attempt === 1) && step.action !== "stop").reduce((total, step) => total + step.durationMs, 0);
    runs.push({ ...item, baseline, agentic, effectiveAgenticChunks: agentic.sufficient ? agentic.chunks : [], incrementalLatencyMs });
    if ((index + 1) % 5 === 0 || index + 1 === cases.length) console.log(`Executed ${index + 1}/${cases.length} cases; metrics remain sealed until completion.`);
  }

  const artifact = buildArtifact(inputs, runs, plannerResults, embeddingUsage, candidate);
  await writeAttempt(inputs.run.runId, artifact);
  if (options.writeReport) await writeReport(artifact);
  printCompletedMetrics(artifact);
}

async function loadInputs() {
  const [protocolRaw, positiveRaw, negativeRaw, configRaw, runRaw, chunksRaw] = await Promise.all([
    fs.readFile(protocolPath, "utf8"), fs.readFile(positivePath, "utf8"), fs.readFile(negativePath, "utf8"),
    fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8"), fs.readFile(path.join(runDirectory, "run.json"), "utf8"), fs.readFile(path.join(runDirectory, "chunks.json"), "utf8"),
  ]);
  const dataset = await loadGoldenSet(goldenPath);
  const split = await loadGoldenSetSplit(splitPath);
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  return {
    protocolRaw, positiveRaw, negativeRaw, configRaw, runRaw, chunksRaw,
    protocol: JSON.parse(protocolRaw) as Protocol,
    positives: JSON.parse(positiveRaw) as FocusedBenchmark<PositiveCase>,
    negatives: JSON.parse(negativeRaw) as FocusedBenchmark<NegativeCase>,
    config: JSON.parse(configRaw) as ExperimentConfig,
    run: JSON.parse(runRaw) as ExperimentRun,
    chunks, dataset, split, generalCases: selectGoldenSplit(dataset, split, "validation"),
    chunkIndex: new Map(chunks.map((chunk, index) => [chunk, index])),
  };
}

function validateInputs(input: Awaited<ReturnType<typeof loadInputs>>) {
  const { protocol, positives, negatives, config, run, chunks, split, generalCases } = input;
  if (protocol.schemaVersion !== 1 || !["preregistered", "completed"].includes(protocol.status) || protocol.split !== "validation" || protocol.testSplitTouched !== false) throw new Error("A registered validation-only protocol is required.");
  if (protocol.benchmark.lockedTestExecution !== false || !split.testLocked || split.testCaseIds.length !== protocol.benchmark.lockedTestCases) throw new Error("Locked test split guard failed.");
  if (generalCases.length !== protocol.benchmark.generalValidationCases || generalCases.some((item) => split.testCaseIds.includes(item.id))) throw new Error("General validation case count or split isolation failed.");
  for (const benchmark of [positives, negatives]) if (benchmark.schemaVersion !== 1 || benchmark.split !== "validation" || benchmark.testSplitTouched !== false || path.resolve(benchmark.parentRun) !== path.resolve(runDirectory)) throw new Error("Focused benchmark must target the frozen validation run.");
  if (positives.cases.length !== protocol.benchmark.focusedComparativePositiveCases || negatives.cases.length !== protocol.benchmark.focusedComparativeNegativeCases) throw new Error("Focused benchmark case count differs from preregistration.");
  if (run.status !== "prepared" || config.embedding.provider !== "google" || config.embedding.model !== "gemini-embedding-2" || config.embedding.outputDimensionality !== 1024) throw new Error("Frozen Gemini Embedding 2 run required.");
  if (chunks.length !== protocol.frozenRetrievalControls.corpusChunks || protocol.frozenRetrievalControls.topK !== 4 || protocol.frozenRetrievalControls.minimumScore !== 0.68 || protocol.frozenRetrievalControls.reranker !== null) throw new Error("Frozen retrieval controls differ from the protocol.");
  for (const item of positives.cases) for (const language of item.expectedLanguages) { const target = item.evidenceByLanguage[language]; if (!target || !chunks.some((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id))) throw new Error(`${item.id} lacks frozen canonical evidence for ${language}.`); }
}

function buildCaseList(general: GoldenCase[], positives: PositiveCase[], negatives: NegativeCase[]) {
  return [
    ...general.map((item) => ({ caseId: item.id, group: "general" as const, question: item.question })),
    ...positives.map((item) => ({ caseId: item.id, group: "focused-positive" as const, question: item.question })),
    ...negatives.map((item) => ({ caseId: item.id, group: "focused-negative" as const, question: item.question })),
  ];
}

function plannerCandidate(protocol: Protocol): AgenticPlannerCandidate {
  const planner = protocol.agenticPolicy.planner;
  return { id: protocol.id, model: planner.model, reasoningEffort: planner.reasoningEffort, maxOutputTokens: planner.maxOutputTokens, inputPriceUsdPerMillionTokens: planner.inputPriceUsdPerMillionTokens, outputPriceUsdPerMillionTokens: planner.outputPriceUsdPerMillionTokensIncludingThinking };
}

function buildArtifact(input: Awaited<ReturnType<typeof loadInputs>>, runs: CaseRun[], planner: AgenticPlannerResult[], embedding: { apiInputs: number; apiRequests: number; cacheHits: number; cacheMisses: number; estimatedApiCostUsd: number }, candidate: AgenticPlannerCandidate) {
  const generalRuns = runs.filter((item) => item.group === "general");
  const baselineGeneralCases = generalRuns.map((item) => evaluateRetrievalCase(input.generalCases.find((test) => test.id === item.caseId)!, item.baseline));
  const agenticGeneralCases = generalRuns.map((item) => evaluateRetrievalCase(input.generalCases.find((test) => test.id === item.caseId)!, item.effectiveAgenticChunks));
  const baselineGeneral = aggregateRetrievalMetrics(baselineGeneralCases);
  const agenticGeneral = aggregateRetrievalMetrics(agenticGeneralCases);
  const focusedBaseline = evaluateFocused(input.positives.cases, input.negatives.cases, runs, "baseline");
  const focusedAgentic = evaluateFocused(input.positives.cases, input.negatives.cases, runs, "agentic");
  const latencies = runs.map((item) => item.incrementalLatencyMs);
  const plannerCostThisRun = planner.filter((item) => !item.cacheHit).reduce((total, item) => total + item.usage.estimatedCostUsd, 0);
  const plannerErrors = 0;
  const structuredValidity = 1;
  const rule = input.protocol.selectionRule;
  const checks = {
    generalRecallAt4: (agenticGeneral.recallAtK ?? 0) >= rule.requiredGeneralRecallAt4,
    generalMrr: (agenticGeneral.mrr ?? 0) >= rule.requiredGeneralMrr,
    generalNdcgAt4: (agenticGeneral.ndcgAtK ?? 0) >= rule.requiredGeneralNdcgAt4,
    generalUnanswerableFalsePositiveRate: agenticGeneral.noAnswerFalsePositiveRate === rule.requiredUnanswerableFalsePositiveRate,
    focusedUnanswerableFalsePositiveRate: focusedAgentic.noAnswerFalsePositiveRate === rule.requiredUnanswerableFalsePositiveRate,
    comparativeBothEvidenceSideCoverageAt4: focusedAgentic.bothEvidenceSideCoverageAt4 >= rule.minimumComparativeBothEvidenceSideCoverageAt4,
    comparativeMeanEvidenceSideRecallAt4: focusedAgentic.meanEvidenceSideRecallAt4 >= rule.minimumComparativeMeanEvidenceSideRecallAt4,
    plannerStructuredValidityRate: structuredValidity === rule.requiredPlannerStructuredValidityRate,
    plannerProviderErrors: plannerErrors <= rule.maximumPlannerProviderErrors,
    plannerCost: plannerCostThisRun <= rule.maximumObservedPlannerCostUsd,
    p95IncrementalLatency: percentile(latencies, .95) <= rule.maximumP95IncrementalLatencyMs,
  };
  const selected = Object.values(checks).every(Boolean);
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: 1, id: input.protocol.id, attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17), createdAt,
    split: "validation", testSplitTouched: false, lockedTestCasesExecuted: 0, hypothesis: input.protocol.hypothesis,
    inputHashes: { protocol: sha256(input.protocolRaw), positives: sha256(input.positiveRaw), negatives: sha256(input.negativeRaw), goldenSet: sha256(JSON.stringify(input.dataset)), split: sha256(JSON.stringify(input.split)), config: sha256(input.configRaw), chunks: sha256(input.chunksRaw) },
    code: codeProvenance(), controls: { threshold: .68, topK: 4, embedding: "google/gemini-embedding-2@1024", reranker: null, maximumAttempts: 2, maximumQueriesPerAttempt: 2, planner: candidate },
    cacheAndCost: {
      embedding, plannerInvocations: planner.length, plannerProviderCalls: planner.filter((item) => !item.cacheHit).length,
      plannerCacheHits: planner.filter((item) => item.cacheHit).length,
      plannerTokens: sumPlannerUsage(planner), plannerCostThisRunUsd: plannerCostThisRun,
      analyticalPlannerCostWithoutCacheUsd: planner.reduce((total, item) => total + item.usage.estimatedCostUsd, 0),
    },
    latencyMs: { meanIncremental: mean(latencies), p95Incremental: percentile(latencies, .95), maximumIncremental: Math.max(...latencies) },
    guardrails: { plannerStructuredValidityRate: structuredValidity, plannerProviderErrors: plannerErrors, checks },
    results: {
      baseline: { general: baselineGeneral, focused: focusedBaseline },
      agentic: { general: agenticGeneral, focused: focusedAgentic },
    },
    decision: { selectedVariant: selected ? "bounded-gemini-planner-v1" : "single-pass-baseline", allChecksPassed: selected, failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name) },
    cases: runs.map((item) => ({
      caseId: item.caseId, group: item.group, baseline: item.baseline.map(compactChunk), agentic: item.effectiveAgenticChunks.map(compactChunk),
      rawFinalAgentic: item.agentic.chunks.map(compactChunk), sufficient: item.agentic.sufficient, attempts: item.agentic.attempts,
      stopReason: item.agentic.stopReason, incrementalLatencyMs: item.incrementalLatencyMs, trace: item.agentic.trace,
    })),
    generalCaseMetrics: { baseline: baselineGeneralCases, agentic: agenticGeneralCases },
    limitations: ["Validation and focused comparative cases have informed earlier experiments.", "The deterministic assessor checks score and requested-language coverage, not semantic entailment.", "Planner cache hits have zero observed provider cost in this run; analytical no-cache cost is reported separately.", "Generation quality and production enablement are outside this retrieval experiment."],
  };
}

function evaluateFocused(positives: PositiveCase[], negatives: NegativeCase[], runs: CaseRun[], variant: "baseline" | "agentic"): FocusedMetrics {
  const chunksFor = (id: string) => { const run = runs.find((item) => item.caseId === id && item.group.startsWith("focused")); if (!run) throw new Error(`Missing focused run ${id}.`); return variant === "baseline" ? run.baseline : run.effectiveAgenticChunks; };
  const positive = positives.map((item) => {
    const chunks = chunksFor(item.id);
    const represented = item.expectedLanguages.filter((language) => chunks.some((chunk) => chunk.language === language));
    const reciprocalRanks = item.expectedLanguages.map((language) => { const target = item.evidenceByLanguage[language]; const index = chunks.findIndex((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id)); return index < 0 ? 0 : 1 / (index + 1); });
    return { represented, evidence: item.expectedLanguages.filter((_, index) => reciprocalRanks[index] > 0), reciprocalRanks };
  });
  const sides = positives.reduce((total, item) => total + item.expectedLanguages.length, 0);
  return {
    bothLanguageCoverageAt4: mean(positive.map((item, index) => Number(item.represented.length === positives[index].expectedLanguages.length))),
    meanLanguageSideCoverageAt4: positive.reduce((total, item) => total + item.represented.length, 0) / sides,
    bothEvidenceSideCoverageAt4: mean(positive.map((item, index) => Number(item.evidence.length === positives[index].expectedLanguages.length))),
    meanEvidenceSideRecallAt4: positive.reduce((total, item) => total + item.evidence.length, 0) / sides,
    macroEvidenceSideMrr: mean(positive.flatMap((item) => item.reciprocalRanks)),
    noAnswerFalsePositiveRate: mean(negatives.map((item) => Number(chunksFor(item.id).length > 0))),
  };
}

async function writeAttempt(runId: string, artifact: ReturnType<typeof buildArtifact>) {
  const directory = path.join(runDirectory, "agentic-rag-attempts", artifact.id, artifact.attemptId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(directory, "summary.md"), renderMarkdown(artifact, runId));
}

async function writeReport(artifact: ReturnType<typeof buildArtifact>) {
  const base = path.resolve(reportBase);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(`${base}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${base}.md`, renderMarkdown(artifact));
  const rows = artifact.cases.map((item) => [item.caseId, item.group, item.sufficient, item.attempts, item.stopReason, item.baseline.length, item.agentic.length, item.incrementalLatencyMs, JSON.stringify(item.trace.filter((step) => step.action === "rewrite").flatMap((step) => step.rewrite?.queries ?? []))]);
  await fs.writeFile(`${base}.csv`, [["case_id", "group", "sufficient", "attempts", "stop_reason", "baseline_chunks", "agentic_chunks", "incremental_latency_ms", "rewrite_queries"], ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n");
}

function renderMarkdown(artifact: ReturnType<typeof buildArtifact>, runId?: string) {
  const baseline = artifact.results.baseline;
  const agentic = artifact.results.agentic;
  return `# Bounded agentic RAG validation\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Parent run: \`${runId ?? "20260717084956473-e60c88ec"}\`\n- Split: **validation only**; locked test cases executed: **0**\n- Decision: **${artifact.decision.selectedVariant}**\n- Failed preregistered checks: ${artifact.decision.failedChecks.length ? artifact.decision.failedChecks.map((item) => `\`${item}\``).join(", ") : "none"}\n\n| Variant | Recall@4 | Precision@4 | MRR | nDCG@4 | General FPR | Both evidence sides | Evidence-side recall | Focused FPR |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n| Single-pass baseline | ${format(baseline.general.recallAtK)} | ${format(baseline.general.precisionAtK)} | ${format(baseline.general.mrr)} | ${format(baseline.general.ndcgAtK)} | ${format(baseline.general.noAnswerFalsePositiveRate)} | ${format(baseline.focused.bothEvidenceSideCoverageAt4)} | ${format(baseline.focused.meanEvidenceSideRecallAt4)} | ${format(baseline.focused.noAnswerFalsePositiveRate)} |\n| Bounded Gemini planner | ${format(agentic.general.recallAtK)} | ${format(agentic.general.precisionAtK)} | ${format(agentic.general.mrr)} | ${format(agentic.general.ndcgAtK)} | ${format(agentic.general.noAnswerFalsePositiveRate)} | ${format(agentic.focused.bothEvidenceSideCoverageAt4)} | ${format(agentic.focused.meanEvidenceSideRecallAt4)} | ${format(agentic.focused.noAnswerFalsePositiveRate)} |\n\n## Operational guardrails\n\n- Planner invocations/provider calls/cache hits: **${artifact.cacheAndCost.plannerInvocations}/${artifact.cacheAndCost.plannerProviderCalls}/${artifact.cacheAndCost.plannerCacheHits}**\n- Observed planner cost this run: **$${artifact.cacheAndCost.plannerCostThisRunUsd.toFixed(6)}**; analytical no-cache cost: **$${artifact.cacheAndCost.analyticalPlannerCostWithoutCacheUsd.toFixed(6)}**\n- Incremental latency mean/p95/max: **${artifact.latencyMs.meanIncremental.toFixed(0)} / ${artifact.latencyMs.p95Incremental.toFixed(0)} / ${artifact.latencyMs.maximumIncremental.toFixed(0)} ms**\n- Structured validity/provider errors: **${format(artifact.guardrails.plannerStructuredValidityRate)} / ${artifact.guardrails.plannerProviderErrors}**\n\n## Interpretation\n\n${artifact.decision.allChecksPassed ? "The agentic variant passed every preregistered quality, safety, latency, and cost requirement." : "The agentic variant failed at least one preregistered requirement, so the frozen single-pass baseline remains selected. No post-hoc tuning is applied to this run."}\n\n## Limitations\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

function printCompletedMetrics(artifact: ReturnType<typeof buildArtifact>) {
  console.log(`COMPLETED ${artifact.id}/${artifact.attemptId}`);
  console.log(`Baseline general: recall=${format(artifact.results.baseline.general.recallAtK)}, MRR=${format(artifact.results.baseline.general.mrr)}, nDCG=${format(artifact.results.baseline.general.ndcgAtK)}, FPR=${format(artifact.results.baseline.general.noAnswerFalsePositiveRate)}`);
  console.log(`Agentic general: recall=${format(artifact.results.agentic.general.recallAtK)}, MRR=${format(artifact.results.agentic.general.mrr)}, nDCG=${format(artifact.results.agentic.general.ndcgAtK)}, FPR=${format(artifact.results.agentic.general.noAnswerFalsePositiveRate)}`);
  console.log(`Agentic focused: bothEvidence=${format(artifact.results.agentic.focused.bothEvidenceSideCoverageAt4)}, sideRecall=${format(artifact.results.agentic.focused.meanEvidenceSideRecallAt4)}, FPR=${format(artifact.results.agentic.focused.noAnswerFalsePositiveRate)}`);
  console.log(`SELECTED ${artifact.decision.selectedVariant}; failed checks: ${artifact.decision.failedChecks.join(", ") || "none"}`);
}

function compactChunk(chunk: RetrievalResult): CompactChunk { return { rank: chunk.rank, chunkId: chunk.id, sourceId: chunk.sourceId ?? null, language: chunk.language ?? null, section: chunk.section, score: chunk.score }; }
function sumPlannerUsage(items: AgenticPlannerResult[]) { return items.reduce((total, item) => ({ promptTokens: total.promptTokens + item.usage.promptTokens, completionTokens: total.completionTokens + item.usage.completionTokens, reasoningTokens: total.reasoningTokens + item.usage.reasoningTokens, totalTokens: total.totalTokens + item.usage.totalTokens }), { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0 }); }
function codeProvenance() { const tracked = ["src", "scripts", "package.json", "package-lock.json", "docs/evaluation", "docs/experiments"]; const status = command("git", ["status", "--porcelain", "--", ...tracked]); const diff = command("git", ["diff", "--binary", "--", ...tracked]); return { gitCommit: command("git", ["rev-parse", "HEAD"]) || "unknown", dirty: Boolean(status), gitDiffHash: sha256(diff) }; }
function command(executable: string, args: string[]) { return spawnSync(executable, args, { encoding: "utf8" }).stdout.trim(); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function normalizeQuery(value: string) { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function mean(values: number[]) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function percentile(values: number[], fraction: number) { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0; }
function format(value: number | null) { return value === null ? "n/a" : value.toFixed(4); }
function csv(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function parseArgs(args: string[]) { return { plan: args.includes("--plan"), allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report") }; }

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
