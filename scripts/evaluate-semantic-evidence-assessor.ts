import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, type GoldenCase } from "../src/lib/rag/golden-set";
import { matchesEvidence } from "../src/lib/rag/retrieval-metrics";
import { assessEvidenceSemantically, type SemanticAssessorCandidate, type SemanticAssessorResult } from "../src/lib/rag/semantic-evidence-assessor";
import type { DocumentationChunk, RetrievalResult } from "../src/lib/rag/types";

const protocolPath = "docs/experiments/agentic-semantic-assessor.v1.json";
const tracePath = "docs/experiment-results/agentic-rag-planner-v3-validation.json";
const chunksPath = "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec/chunks.json";
const positivePath = "docs/evaluation/multi-technology-retrieval-benchmark.v1.json";
const negativePath = "docs/evaluation/multi-technology-negative-benchmark.v1.json";
const outputBase = "docs/experiment-results/agentic-semantic-assessor-v1-validation";

type EvidenceTarget = { sourceId: string; acceptedChunkIds: string[] };
type PositiveCase = { id: string; question: string; expectedLanguages: string[]; evidenceByLanguage: Record<string, EvidenceTarget> };
type NegativeCase = { id: string; question: string };
type Protocol = {
  id: string; status: "preregistered" | "completed"; sourceTrace: string; expectedStates: number; expectedProviderEligibleStates: number;
  candidate: SemanticAssessorCandidate;
  selectionRule: { minimumAccuracy: number; minimumRecall: number; requiredFalsePositiveRate: number; mustExceedDeterministicAccuracy: boolean; mustReduceDeterministicFalsePositiveRate: boolean; maximumProviderErrors: number; maximumCostUsd: number; maximumP95LatencyMs: number };
};
type TraceStep = { attempt: number; action: string; retrieved?: Array<{ id: string; rank: number; score: number; language?: string }>; assessment?: { sufficient: boolean } };
type TraceCase = { caseId: string; group: "general" | "focused-positive" | "focused-negative"; baseline: CompactChunk[]; rawFinalAgentic: CompactChunk[]; trace: TraceStep[] };
type CompactChunk = { chunkId: string; sourceId: string | null; language: string | null; section: string; score: number; rank: number };
type V3Artifact = { id: string; cases: TraceCase[] };
type State = { id: string; caseId: string; group: TraceCase["group"]; attempt: number; question: string; chunks: RetrievalResult[]; expectedSufficient: boolean; deterministicSufficient: boolean };

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const flags = { plan: process.argv.includes("--plan"), allowProviderRequests: process.argv.includes("--allow-provider-requests"), write: process.argv.includes("--write-report") };
  const inputs = await loadInputs();
  const states = buildStates(inputs);
  validate(inputs.protocol, inputs.trace, states);
  const deterministic = classification(states.map((item) => ({ expected: item.expectedSufficient, predicted: item.deterministicSufficient })));
  if (flags.plan) {
    console.log(`VALID ${inputs.protocol.id}: ${states.length} frozen retrieval states (${states.filter((item) => item.chunks.length).length} provider-eligible, ${states.filter((item) => !item.chunks.length).length} deterministic-empty).`);
    console.log(`Frozen deterministic assessor: accuracy=${format(deterministic.accuracy)}, recall=${format(deterministic.recall)}, FPR=${format(deterministic.falsePositiveRate)}.`);
    return;
  }
  if (inputs.protocol.status === "completed") throw new Error("Completed semantic-assessor protocols cannot be rerun in place.");
  if (!flags.allowProviderRequests) throw new Error("Provider requests require --allow-provider-requests after preregistration is committed.");

  const observations: Array<{ state: State; result: SemanticAssessorResult }> = [];
  let providerErrors = 0;
  let observedCost = 0;
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    if (observedCost >= inputs.protocol.selectionRule.maximumCostUsd) throw new Error(`Semantic assessor cost guardrail reached $${observedCost.toFixed(6)}.`);
    try {
      const result = await assessEvidenceSemantically({ candidate: inputs.protocol.candidate, question: state.question, chunks: state.chunks, allowProviderRequests: true });
      observations.push({ state, result });
      if (!result.cacheHit) observedCost += result.usage.costUsd;
    } catch (error) {
      providerErrors += 1;
      throw error;
    }
    if ((index + 1) % 10 === 0 || index + 1 === states.length) console.log(`Executed ${index + 1}/${states.length} assessor states; metrics remain sealed until completion.`);
  }

  const semantic = classification(observations.map((item) => ({ expected: item.state.expectedSufficient, predicted: item.result.assessment.sufficient })));
  const latencies = observations.filter((item) => item.result.providerInvoked).map((item) => item.result.latencyMs);
  const actualCost = observations.filter((item) => !item.result.cacheHit).reduce((total, item) => total + item.result.usage.costUsd, 0);
  const rule = inputs.protocol.selectionRule;
  const checks = {
    accuracy: semantic.accuracy >= rule.minimumAccuracy,
    recall: semantic.recall >= rule.minimumRecall,
    falsePositiveRate: semantic.falsePositiveRate === rule.requiredFalsePositiveRate,
    exceedsDeterministicAccuracy: !rule.mustExceedDeterministicAccuracy || semantic.accuracy > deterministic.accuracy,
    reducesDeterministicFalsePositiveRate: !rule.mustReduceDeterministicFalsePositiveRate || semantic.falsePositiveRate < deterministic.falsePositiveRate,
    providerErrors: providerErrors <= rule.maximumProviderErrors,
    cost: actualCost <= rule.maximumCostUsd,
    p95Latency: percentile(latencies, .95) <= rule.maximumP95LatencyMs,
  };
  const selected = Object.values(checks).every(Boolean);
  const artifact = {
    schemaVersion: 1, id: inputs.protocol.id, createdAt: new Date().toISOString(), split: "validation", sourceTrace: tracePath,
    sourceTraceSha256: sha256(inputs.traceRaw), lockedTestTouched: false,
    sample: { states: states.length, positiveLabels: states.filter((item) => item.expectedSufficient).length, negativeLabels: states.filter((item) => !item.expectedSufficient).length, providerEligibleStates: states.filter((item) => item.chunks.length).length },
    candidate: inputs.protocol.candidate, results: { deterministic, semantic },
    execution: { providerCalls: observations.filter((item) => item.result.providerInvoked && !item.result.cacheHit).length, cacheHits: observations.filter((item) => item.result.cacheHit && item.result.providerInvoked).length, deterministicEmptyDecisions: observations.filter((item) => !item.result.providerInvoked).length, providerErrors, observedCostUsd: actualCost, tokens: sumUsage(observations), latencyMs: { mean: mean(latencies), p95: percentile(latencies, .95), maximum: Math.max(...latencies) } },
    selection: { selectedForEndToEndIntegration: selected, checks, failedChecks: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name) },
    observations: observations.map((item) => ({ stateId: item.state.id, caseId: item.state.caseId, group: item.state.group, attempt: item.state.attempt, expectedSufficient: item.state.expectedSufficient, deterministicSufficient: item.state.deterministicSufficient, semanticSufficient: item.result.assessment.sufficient, assessment: item.result.assessment, retrieved: item.state.chunks.map((chunk) => ({ rank: chunk.rank, id: chunk.id, sourceId: chunk.sourceId, language: chunk.language, section: chunk.section, score: chunk.score })), response: { model: item.result.responseModel, provider: item.result.responseProvider, id: item.result.responseId, finishReason: item.result.finishReason, usage: item.result.usage, latencyMs: item.result.latencyMs, cacheHit: item.result.cacheHit } })),
    limitations: ["Labels credit only frozen canonical evidence and may reject other genuinely sufficient excerpts.", "The same validation benchmark informed the v3 diagnosis; this selects a component for another validation experiment, not production.", "GPT-5.4 Mini failed some ordinal generation-judge calibration metrics despite strong binary agreement."]
  };
  if (flags.write) await writeOutputs(artifact);
  console.log(`COMPLETED ${artifact.id}: deterministic accuracy=${format(deterministic.accuracy)}, FPR=${format(deterministic.falsePositiveRate)}; semantic accuracy=${format(semantic.accuracy)}, recall=${format(semantic.recall)}, FPR=${format(semantic.falsePositiveRate)}.`);
  console.log(`SELECTED FOR INTEGRATION ${selected ? "yes" : "no"}; failed checks: ${artifact.selection.failedChecks.join(", ") || "none"}; cost=$${actualCost.toFixed(6)}.`);
}

async function loadInputs() {
  const [protocolRaw, traceRaw, chunksRaw, positivesRaw, negativesRaw, dataset, split] = await Promise.all([
    fs.readFile(protocolPath, "utf8"), fs.readFile(tracePath, "utf8"), fs.readFile(chunksPath, "utf8"), fs.readFile(positivePath, "utf8"), fs.readFile(negativePath, "utf8"), loadGoldenSet("docs/evaluation/golden-set.v4.json"), loadGoldenSetSplit("docs/evaluation/golden-set-splits.v4.json"),
  ]);
  return { protocolRaw, traceRaw, protocol: JSON.parse(protocolRaw) as Protocol, trace: JSON.parse(traceRaw) as V3Artifact, chunks: JSON.parse(chunksRaw) as DocumentationChunk[], positives: (JSON.parse(positivesRaw) as { cases: PositiveCase[] }).cases, negatives: (JSON.parse(negativesRaw) as { cases: NegativeCase[] }).cases, general: selectGoldenSplit(dataset, split, "validation") };
}

function buildStates(input: Awaited<ReturnType<typeof loadInputs>>) {
  const questions = new Map<string, string>([...input.general.map((item) => [item.id, item.question] as const), ...input.positives.map((item) => [item.id, item.question] as const), ...input.negatives.map((item) => [item.id, item.question] as const)]);
  const chunksById = new Map<string, DocumentationChunk[]>();
  for (const chunk of input.chunks) chunksById.set(chunk.id, [...(chunksById.get(chunk.id) ?? []), chunk]);
  return input.trace.cases.flatMap((item) => item.trace.filter((step) => step.action === "retrieve").map((step) => {
    const compacts = step.attempt === 1 ? item.baseline : item.rawFinalAgentic;
    const chunks = (step.retrieved ?? []).map((retrieved) => reconstruct(retrieved, compacts, chunksById));
    const assessment = item.trace.find((candidate) => candidate.action === "assess" && candidate.attempt === step.attempt)?.assessment;
    if (!assessment) throw new Error(`${item.caseId}/attempt-${step.attempt} lacks deterministic assessment.`);
    return { id: `${item.caseId}::attempt-${step.attempt}`, caseId: item.caseId, group: item.group, attempt: step.attempt, question: questions.get(item.caseId)!, chunks, expectedSufficient: expectedSufficiency(item, chunks, input.general, input.positives), deterministicSufficient: assessment.sufficient } satisfies State;
  }));
}

function reconstruct(retrieved: NonNullable<TraceStep["retrieved"]>[number], compacts: CompactChunk[], chunksById: Map<string, DocumentationChunk[]>) {
  const compact = compacts.find((item) => item.chunkId === retrieved.id && item.rank === retrieved.rank) ?? compacts.find((item) => item.chunkId === retrieved.id);
  const candidates = chunksById.get(retrieved.id) ?? [];
  const chunk = candidates.find((item) => (!compact?.sourceId || item.sourceId === compact.sourceId) && (!retrieved.language || item.language === retrieved.language)) ?? candidates[0];
  if (!chunk) throw new Error(`Unable to reconstruct frozen chunk ${retrieved.id}.`);
  return { ...chunk, rank: retrieved.rank, score: retrieved.score };
}

function expectedSufficiency(item: TraceCase, chunks: RetrievalResult[], general: GoldenCase[], positives: PositiveCase[]) {
  if (item.group === "focused-negative") return false;
  if (item.group === "general") { const test = general.find((candidate) => candidate.id === item.caseId)!; return test.answerability === "answerable" && chunks.some((chunk) => test.evidence.some((evidence) => matchesEvidence(chunk, evidence))); }
  const test = positives.find((candidate) => candidate.id === item.caseId)!;
  return test.expectedLanguages.every((language) => { const target = test.evidenceByLanguage[language]; return chunks.some((chunk) => chunk.language === language && chunk.sourceId === target.sourceId && target.acceptedChunkIds.includes(chunk.id)); });
}

function validate(protocol: Protocol, trace: V3Artifact, states: State[]) {
  if (protocol.status !== "preregistered" && protocol.status !== "completed") throw new Error("Semantic assessor protocol must be registered.");
  if (path.resolve(protocol.sourceTrace) !== path.resolve(tracePath) || trace.id !== "agentic-rag-planner-v3") throw new Error("Frozen v3 trace required.");
  if (states.length !== protocol.expectedStates || states.filter((item) => item.chunks.length).length !== protocol.expectedProviderEligibleStates) throw new Error("Frozen state counts differ from preregistration.");
  if (states.some((item) => !item.question)) throw new Error("Every assessor state requires its original question.");
}

function classification(items: Array<{ expected: boolean; predicted: boolean }>) { const tp = items.filter((item) => item.expected && item.predicted).length; const tn = items.filter((item) => !item.expected && !item.predicted).length; const fp = items.filter((item) => !item.expected && item.predicted).length; const fn = items.filter((item) => item.expected && !item.predicted).length; return { total: items.length, truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn, accuracy: (tp + tn) / items.length, precision: tp / Math.max(tp + fp, 1), recall: tp / Math.max(tp + fn, 1), specificity: tn / Math.max(tn + fp, 1), falsePositiveRate: fp / Math.max(fp + tn, 1), falseNegativeRate: fn / Math.max(fn + tp, 1) }; }
function sumUsage(items: Array<{ result: SemanticAssessorResult }>) { return items.reduce((total, item) => ({ prompt: total.prompt + item.result.usage.promptTokens, completion: total.completion + item.result.usage.completionTokens, reasoning: total.reasoning + item.result.usage.reasoningTokens, total: total.total + item.result.usage.totalTokens }), { prompt: 0, completion: 0, reasoning: 0, total: 0 }); }
async function writeOutputs(artifact: Record<string, unknown> & { id: string; results: { deterministic: ReturnType<typeof classification>; semantic: ReturnType<typeof classification> }; selection: { selectedForEndToEndIntegration: boolean; failedChecks: string[] }; execution: { observedCostUsd: number; providerCalls: number; latencyMs: { p95: number } }; sample: { states: number; positiveLabels: number; negativeLabels: number } }) { await fs.writeFile(`${outputBase}.json`, `${JSON.stringify(artifact, null, 2)}\n`); await fs.writeFile(`${outputBase}.md`, `# Semantic evidence assessor validation\n\n- Frozen v3 retrieval states: **${artifact.sample.states}** (${artifact.sample.positiveLabels} sufficient, ${artifact.sample.negativeLabels} insufficient)\n- Provider calls: **${artifact.execution.providerCalls}**\n- Observed cost: **$${artifact.execution.observedCostUsd.toFixed(6)}**\n- P95 provider latency: **${artifact.execution.latencyMs.p95.toFixed(0)} ms**\n- Selected for end-to-end integration: **${artifact.selection.selectedForEndToEndIntegration ? "yes" : "no"}**\n\n| Assessor | Accuracy | Recall | FPR |\n|---|---:|---:|---:|\n| Deterministic score/language | ${format(artifact.results.deterministic.accuracy)} | ${format(artifact.results.deterministic.recall)} | ${format(artifact.results.deterministic.falsePositiveRate)} |\n| GPT-5.4 Mini semantic | ${format(artifact.results.semantic.accuracy)} | ${format(artifact.results.semantic.recall)} | ${format(artifact.results.semantic.falsePositiveRate)} |\n\nFailed checks: ${artifact.selection.failedChecks.length ? artifact.selection.failedChecks.join(", ") : "none"}.\n`); }
function mean(values: number[]) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function percentile(values: number[], fraction: number) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number) { return value.toFixed(4); }

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
