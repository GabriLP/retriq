import crypto from "node:crypto";
import fs from "node:fs/promises";

import * as nextEnv from "@next/env";

import { assessAgenticEvidence } from "../src/lib/rag/agentic-assessor";
import { assessEvidenceSemantically, type SemanticAssessorCandidate, type SemanticAssessorResult } from "../src/lib/rag/semantic-evidence-assessor";
import type { DocumentationChunk, RetrievalResult } from "../src/lib/rag/types";

const protocolPath = "docs/experiments/agentic-semantic-assessor.v2.json";
const seedPath = "docs/evaluation/semantic-evidence-benchmark.v2.seed.json";
const benchmarkPath = "docs/evaluation/semantic-evidence-benchmark.v2.json";
const referencePath = "docs/evaluation/semantic-evidence-benchmark-v2-human-review.completed.csv";
const chunksPath = "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec/chunks.json";
const outputBase = "docs/experiment-results/agentic-semantic-assessor-v2-validation";

type Protocol = {
  id: string;
  status: "human-reference-frozen" | "completed";
  candidate: SemanticAssessorCandidate;
  benchmark: { seedSha256: string; packetsSha256: string; states: number; uniqueQuestions: number; chunksPerPacket: number };
  humanReference: { path: string; sha256: string; rows: number; sufficient: number; insufficient: number; provenance: string; independent: boolean };
  selectionRule: { minimumAccuracy: number; minimumRecall: number; maximumFalsePositiveRate: number; mustExceedDeterministicAccuracy: boolean; mustNotIncreaseDeterministicFalsePositiveRate: boolean; maximumProviderErrors: number; maximumCostUsd: number; maximumP95LatencyMs: number };
};
type Seed = { questions: Array<{ id: string; technology: string; question: string; expectedFacts: string[] }> };
type Packet = { id: string; caseId: string; constructionCategory: string; intendedSufficient: boolean; evidence: Array<{ id: string; sourceId: string | null; score: number; rank: number }> };
type Benchmark = { id: string; lockedTestTouched: boolean; reviewOrder: string[]; states: Packet[] };
type HumanLabel = { stateId: string; caseId: string; sufficient: boolean; reviewedBy: string; reviewedAt: string };
type State = { packet: Packet; question: string; technology: string; expectedFacts: string[]; human: HumanLabel; chunks: RetrievalResult[]; deterministicSufficient: boolean };

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const flags = { plan: process.argv.includes("--plan"), allowProviderRequests: process.argv.includes("--allow-provider-requests"), write: process.argv.includes("--write-report") };
  const input = await loadInputs();
  const states = buildStates(input);
  validate(input, states);
  const deterministic = classification(states.map((state) => ({ expected: state.human.sufficient, predicted: state.deterministicSufficient })));
  if (flags.plan) {
    console.log(`VALID ${input.protocol.id}: 24 frozen packets with an AI-assisted human reference (12 sufficient, 12 insufficient).`);
    console.log(`Deterministic baseline: accuracy=${format(deterministic.accuracy)}, recall=${format(deterministic.recall)}, FPR=${format(deterministic.falsePositiveRate)}, kappa=${format(deterministic.kappa)}.`);
    return;
  }
  if (input.protocol.status === "completed") throw new Error("A completed v2 protocol cannot be rerun in place.");
  if (!flags.allowProviderRequests) throw new Error("Provider requests require --allow-provider-requests.");

  const observations: Array<{ state: State; result: SemanticAssessorResult }> = [];
  let providerErrors = 0;
  for (let index = 0; index < states.length; index += 1) {
    try {
      const result = await assessEvidenceSemantically({ candidate: input.protocol.candidate, question: states[index].question, chunks: states[index].chunks, allowProviderRequests: true });
      observations.push({ state: states[index], result });
      const runningCost = observations.filter((item) => !item.result.cacheHit).reduce((sum, item) => sum + item.result.usage.costUsd, 0);
      if (runningCost > input.protocol.selectionRule.maximumCostUsd) throw new Error(`Cost guardrail exceeded: $${runningCost.toFixed(6)}.`);
    } catch (error) {
      providerErrors += 1;
      throw error;
    }
    if ((index + 1) % 6 === 0) console.log(`Executed ${index + 1}/${states.length} frozen packets; aggregate metrics remain sealed.`);
  }

  const semantic = classification(observations.map((item) => ({ expected: item.state.human.sufficient, predicted: item.result.assessment.sufficient })));
  const latencies = observations.filter((item) => item.result.providerInvoked && !item.result.cacheHit).map((item) => item.result.latencyMs);
  const cost = observations.filter((item) => !item.result.cacheHit).reduce((sum, item) => sum + item.result.usage.costUsd, 0);
  const rule = input.protocol.selectionRule;
  const checks = {
    accuracy: semantic.accuracy >= rule.minimumAccuracy,
    recall: semantic.recall >= rule.minimumRecall,
    falsePositiveRate: semantic.falsePositiveRate <= rule.maximumFalsePositiveRate,
    exceedsDeterministicAccuracy: !rule.mustExceedDeterministicAccuracy || semantic.accuracy > deterministic.accuracy,
    doesNotIncreaseDeterministicFpr: !rule.mustNotIncreaseDeterministicFalsePositiveRate || semantic.falsePositiveRate <= deterministic.falsePositiveRate,
    providerErrors: providerErrors <= rule.maximumProviderErrors,
    cost: cost <= rule.maximumCostUsd,
    p95Latency: percentile(latencies, .95) <= rule.maximumP95LatencyMs,
  };
  const selected = Object.values(checks).every(Boolean);
  const artifact = {
    schemaVersion: 1,
    id: input.protocol.id,
    createdAt: new Date().toISOString(),
    reference: { path: referencePath, sha256: sha256(input.referenceRaw), provenance: input.protocol.humanReference.provenance, independent: false, agreementWithConstruction: states.filter((state) => state.human.sufficient === state.packet.intendedSufficient).length / states.length },
    benchmark: { path: benchmarkPath, sha256: sha256(input.benchmarkRaw), states: states.length, questions: new Set(states.map((state) => state.packet.caseId)).size, lockedTestTouched: false },
    candidate: input.protocol.candidate,
    results: { deterministic, semantic },
    execution: { providerCalls: observations.filter((item) => item.result.providerInvoked && !item.result.cacheHit).length, cacheHits: observations.filter((item) => item.result.cacheHit).length, providerErrors, observedCostUsd: cost, tokens: sumUsage(observations), latencyMs: { mean: mean(latencies), p95: percentile(latencies, .95), maximum: Math.max(0, ...latencies) } },
    selection: { qualifiedForOneEndToEndExperiment: selected, checks, failedChecks: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name) },
    observations: observations.map(({ state, result }) => ({ stateId: state.packet.id, caseId: state.packet.caseId, technology: state.technology, constructionCategory: state.packet.constructionCategory, intendedSufficient: state.packet.intendedSufficient, humanSufficient: state.human.sufficient, deterministicSufficient: state.deterministicSufficient, semanticSufficient: result.assessment.sufficient, assessment: result.assessment, evidence: state.chunks.map((chunk) => ({ id: chunk.id, sourceId: chunk.sourceId, rank: chunk.rank, score: chunk.score, title: chunk.title, section: chunk.section, language: chunk.language })), response: { model: result.responseModel, provider: result.responseProvider, id: result.responseId, finishReason: result.finishReason, usage: result.usage, latencyMs: result.latencyMs, cacheHit: result.cacheHit } })),
    limitations: ["The 24-packet sample is a bounded in-domain component benchmark.", "The thesis author completed the reference with case-level Codex assistance; it is not an independent human gold standard.", "Construction agreement describes dataset consistency, not independent validation.", "Qualification permits only one preregistered end-to-end validation experiment, not production activation."],
  };
  if (flags.write) await writeOutputs(artifact);
  console.log(`COMPLETED ${artifact.id}: deterministic accuracy=${format(deterministic.accuracy)}, FPR=${format(deterministic.falsePositiveRate)}; semantic accuracy=${format(semantic.accuracy)}, recall=${format(semantic.recall)}, FPR=${format(semantic.falsePositiveRate)}, kappa=${format(semantic.kappa)}.`);
  console.log(`QUALIFIED ${selected ? "yes" : "no"}; failed checks: ${artifact.selection.failedChecks.join(", ") || "none"}; cost=$${cost.toFixed(6)}.`);
}

async function loadInputs() {
  const [protocolRaw, seedRaw, benchmarkRaw, referenceRaw, chunksRaw] = await Promise.all([protocolPath, seedPath, benchmarkPath, referencePath, chunksPath].map((file) => fs.readFile(file, "utf8")));
  return { protocol: JSON.parse(protocolRaw) as Protocol, seed: JSON.parse(seedRaw) as Seed, benchmark: JSON.parse(benchmarkRaw) as Benchmark, labels: parseReference(referenceRaw), chunks: JSON.parse(chunksRaw) as DocumentationChunk[], seedRaw, benchmarkRaw, referenceRaw };
}

function buildStates(input: Awaited<ReturnType<typeof loadInputs>>) {
  const questions = new Map(input.seed.questions.map((item) => [item.id, item]));
  const labels = new Map(input.labels.map((item) => [item.stateId, item]));
  const chunks = new Map(input.chunks.map((item) => [item.id, item]));
  const packets = new Map(input.benchmark.states.map((item) => [item.id, item]));
  return input.benchmark.reviewOrder.map((id) => {
    const packet = packets.get(id)!;
    const question = questions.get(packet.caseId)!;
    const evidence = packet.evidence.map((item) => {
      const chunk = chunks.get(item.id);
      if (!chunk) throw new Error(`${id}: missing corpus chunk ${item.id}.`);
      return { ...chunk, rank: item.rank, score: item.score } satisfies RetrievalResult;
    });
    return { packet, question: question.question, technology: question.technology, expectedFacts: question.expectedFacts, human: labels.get(id)!, chunks: evidence, deterministicSufficient: assessAgenticEvidence({ question: question.question, chunks: evidence }).sufficient };
  });
}

function validate(input: Awaited<ReturnType<typeof loadInputs>>, states: State[]) {
  const errors: string[] = [];
  if (input.protocol.id !== "agentic-semantic-assessor-v2" || !["human-reference-frozen", "completed"].includes(input.protocol.status)) errors.push("Protocol is not at the frozen-reference gate.");
  if (input.protocol.status === "human-reference-frozen" && input.protocol.humanReference.sha256 !== sha256(input.referenceRaw)) errors.push("Human-reference hash mismatch.");
  if (input.protocol.benchmark.seedSha256 !== sha256(input.seedRaw) || input.protocol.benchmark.packetsSha256 !== sha256(input.benchmarkRaw)) errors.push("Frozen benchmark hash mismatch.");
  if (input.protocol.humanReference.provenance !== "ai-assisted-human-review" || input.protocol.humanReference.independent) errors.push("Reference provenance must disclose AI assistance.");
  if (states.length !== 24 || input.labels.length !== 24 || new Set(input.labels.map((item) => item.stateId)).size !== 24) errors.push("Expected 24 unique labels and states.");
  if (states.some((state) => !state.packet || !state.human || !state.question || state.chunks.length !== 2)) errors.push("Every state requires a question, label, and two chunks.");
  if (states.filter((state) => state.human.sufficient).length !== 12 || states.filter((state) => !state.human.sufficient).length !== 12) errors.push("Expected a 12/12 human-label balance.");
  if (input.benchmark.lockedTestTouched) errors.push("Locked test must remain untouched.");
  if (errors.length) throw new Error(errors.join("\n"));
}

function parseReference(raw: string): HumanLabel[] {
  return raw.trim().split(/\r?\n/).slice(1).map((line) => {
    const columns = line.split(",");
    if (columns.length !== 9 || columns[8] !== "agentic-semantic-assessor-v2" || !["0", "1"].includes(columns[4])) throw new Error(`Invalid reference row: ${line}`);
    return { stateId: columns[1], caseId: columns[2], sufficient: columns[4] === "1", reviewedBy: columns[6], reviewedAt: columns[7] };
  });
}

function classification(items: Array<{ expected: boolean; predicted: boolean }>) {
  const tp = items.filter((item) => item.expected && item.predicted).length, tn = items.filter((item) => !item.expected && !item.predicted).length;
  const fp = items.filter((item) => !item.expected && item.predicted).length, fn = items.filter((item) => item.expected && !item.predicted).length;
  const accuracy = (tp + tn) / items.length, precision = tp / Math.max(tp + fp, 1), recall = tp / Math.max(tp + fn, 1), specificity = tn / Math.max(tn + fp, 1);
  const expectedPositive = (tp + fn) / items.length, predictedPositive = (tp + fp) / items.length;
  const chance = expectedPositive * predictedPositive + (1 - expectedPositive) * (1 - predictedPositive);
  return { total: items.length, truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn, accuracy, balancedAccuracy: (recall + specificity) / 2, precision, recall, specificity, falsePositiveRate: fp / Math.max(fp + tn, 1), falseNegativeRate: fn / Math.max(fn + tp, 1), kappa: chance === 1 ? 1 : (accuracy - chance) / (1 - chance) };
}

async function writeOutputs(artifact: any) {
  await fs.writeFile(`${outputBase}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${outputBase}.md`, `# Semantic evidence assessor v2\n\nThe frozen reference is **AI-assisted human review**, not an independent human gold standard.\n\n| Assessor | Accuracy | Balanced accuracy | Precision | Recall | Specificity | FPR | Kappa |\n|---|---:|---:|---:|---:|---:|---:|---:|\n| Deterministic | ${metricRow(artifact.results.deterministic)} |\n| GPT-5.4 Mini semantic | ${metricRow(artifact.results.semantic)} |\n\n- Provider calls: **${artifact.execution.providerCalls}**; cache hits: **${artifact.execution.cacheHits}**; errors: **${artifact.execution.providerErrors}**\n- Cost: **$${artifact.execution.observedCostUsd.toFixed(6)}**\n- P95 latency: **${artifact.execution.latencyMs.p95.toFixed(0)} ms**\n- Qualified for one end-to-end experiment: **${artifact.selection.qualifiedForOneEndToEndExperiment ? "yes" : "no"}**\n- Failed checks: **${artifact.selection.failedChecks.join(", ") || "none"}**\n`);
  const header = "state_id,human_sufficient,deterministic_sufficient,semantic_sufficient,semantic_reason";
  const rows = artifact.observations.map((item: any) => [item.stateId, Number(item.humanSufficient), Number(item.deterministicSufficient), Number(item.semanticSufficient), csv(item.assessment.reason)].join(","));
  await fs.writeFile(`${outputBase}-predictions.csv`, `${header}\n${rows.join("\n")}\n`);
}

function metricRow(value: ReturnType<typeof classification>) { return [value.accuracy, value.balancedAccuracy, value.precision, value.recall, value.specificity, value.falsePositiveRate, value.kappa].map(format).join(" | "); }
function sumUsage(items: Array<{ result: SemanticAssessorResult }>) { return items.reduce((sum, item) => ({ promptTokens: sum.promptTokens + item.result.usage.promptTokens, completionTokens: sum.completionTokens + item.result.usage.completionTokens, reasoningTokens: sum.reasoningTokens + item.result.usage.reasoningTokens, totalTokens: sum.totalTokens + item.result.usage.totalTokens }), { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0 }); }
function percentile(values: number[], fraction: number) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0; }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number) { return value.toFixed(4); }
function csv(value: string) { return `"${value.replaceAll('"', '""')}"`; }

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
