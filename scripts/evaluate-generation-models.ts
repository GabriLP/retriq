import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import { generateWithCandidate, type GeneratorCandidate, type GeneratorResult } from "../src/lib/rag/generator-providers";
import type { DocumentationChunk } from "../src/lib/rag/types";

type Protocol = {
  schemaVersion: 1;
  id: string;
  status: string;
  split: "validation";
  benchmark: string;
  prompt: string;
  humanRubric: string;
  parentRun: string;
  generatorCandidates: GeneratorCandidate[];
  controlledVariables: string[];
  reportOutput: string;
};
type EvidenceRef = { rank: number; chunkId: string; title: string; section: string; sourceUrl: string; contentSha256: string; promptDocumentSha256: string };
type BenchmarkCase = {
  caseId: string;
  language: string;
  domain: string;
  difficulty: string;
  questionType: string;
  answerability: "answerable" | "unanswerable";
  question: string;
  expected: { answer?: string; keyFacts: string[]; refusalReason?: string };
  evidence: EvidenceRef[];
  generationPolicy: "invoke-generator" | "deterministic-abstention";
};
type Benchmark = { schemaVersion: 1; id: string; split: "validation"; source: { chunksSha256: string }; humanCalibration: { caseIds: string[] }; testSplit: { touched: boolean }; cases: BenchmarkCase[] };
type Prompt = { schemaVersion: 1; id: string; systemInstructions: string[]; userTemplate: string; evidenceTemplate: string; separator: string; generationControls: { temperature: number; maxOutputTokens: number }; noEvidencePolicy: { invokeGenerator: false; deterministicAnswer: string; answerStatus: string } };
type CaseOutput = {
  caseId: string;
  answerability: string;
  candidateId: string;
  blindVariantId: string;
  answer: string;
  responseHash: string;
  answerStatus: string;
  generationPolicy: string;
  result: GeneratorResult | null;
  error: string | null;
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const protocolPath = path.resolve(options.protocol);
  const protocolRaw = await fs.readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw) as Protocol;
  validateProtocol(protocol);
  const benchmarkRaw = await fs.readFile(path.resolve(protocol.benchmark), "utf8");
  const benchmark = JSON.parse(benchmarkRaw) as Benchmark;
  const promptRaw = await fs.readFile(path.resolve(protocol.prompt), "utf8");
  const prompt = JSON.parse(promptRaw) as Prompt;
  const chunksPath = path.resolve(protocol.parentRun, "chunks.json");
  const chunksRaw = await fs.readFile(chunksPath, "utf8");
  if (sha256(chunksRaw) !== benchmark.source.chunksSha256) throw new Error("Parent chunks hash differs from the frozen benchmark.");
  if (benchmark.split !== "validation" || benchmark.testSplit.touched) throw new Error("Generation model selection must use untouched validation data only.");

  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const prepared = benchmark.cases.map((item) => ({ item, evidence: reconstructEvidence(item.evidence, chunksById), prompt: buildPrompt(item, prompt, chunksById) }));
  const estimate = estimateExperiment(prepared, protocol.generatorCandidates);
  if (options.estimateOnly) {
    console.log(JSON.stringify(estimate, null, 2));
    return;
  }
  if (!options.allowProviderRequests) throw new Error("Use --allow-provider-requests after reviewing --estimate-only output.");

  const outputs: CaseOutput[] = [];
  const started = performance.now();
  for (const candidate of protocol.generatorCandidates) {
    console.log(`Generating ${candidate.id}...`);
    for (const entry of prepared) {
      const blindVariantId = blindId(candidate.id);
      if (entry.item.generationPolicy === "deterministic-abstention") {
        const answer = prompt.noEvidencePolicy.deterministicAnswer;
        outputs.push({ caseId: entry.item.caseId, answerability: entry.item.answerability, candidateId: candidate.id, blindVariantId, answer, responseHash: sha256(answer), answerStatus: prompt.noEvidencePolicy.answerStatus, generationPolicy: entry.item.generationPolicy, result: null, error: null });
        continue;
      }
      try {
        const result = await generateWithCandidate({
          candidate,
          systemInstruction: prompt.systemInstructions.join("\n"),
          userPrompt: entry.prompt,
          temperature: prompt.generationControls.temperature,
          maxOutputTokens: prompt.generationControls.maxOutputTokens,
          allowProviderRequests: true,
        });
        outputs.push({ caseId: entry.item.caseId, answerability: entry.item.answerability, candidateId: candidate.id, blindVariantId, answer: result.answer, responseHash: sha256(result.answer), answerStatus: classifyAnswerStatus(result.answer), generationPolicy: entry.item.generationPolicy, result, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputs.push({ caseId: entry.item.caseId, answerability: entry.item.answerability, candidateId: candidate.id, blindVariantId, answer: "", responseHash: sha256(""), answerStatus: "error", generationPolicy: entry.item.generationPolicy, result: null, error: message });
        console.error(`${candidate.id}/${entry.item.caseId}: ${message}`);
      }
    }
  }

  const createdAt = new Date().toISOString();
  const attemptId = createdAt.replace(/[-:.TZ]/g, "").slice(0, 17);
  const summaries = protocol.generatorCandidates.map((candidate) => summarizeCandidate(candidate, outputs));
  const artifact = {
    schemaVersion: 1,
    id: protocol.id,
    attemptId,
    createdAt,
    split: "validation",
    benchmark: benchmark.id,
    prompt: prompt.id,
    inputHashes: { protocol: sha256(protocolRaw), benchmark: sha256(benchmarkRaw), prompt: sha256(promptRaw), chunks: sha256(chunksRaw) },
    controls: { temperature: prompt.generationControls.temperature, maxOutputTokens: prompt.generationControls.maxOutputTokens, judgeEnabled: false, variables: protocol.controlledVariables },
    candidates: protocol.generatorCandidates,
    estimate,
    summaries,
    outputs,
    elapsedMs: Math.round(performance.now() - started),
    selectionStatus: "awaiting-human-review",
    testSplitTouched: false,
  };
  const directory = path.resolve("data/experiments/generation-models-v1", attemptId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(directory, "summary.md"), renderSummary(artifact));
  if (options.writeReport) await writeTrackedReports(protocol.reportOutput, artifact, benchmark, prepared);
  console.log(`COMPLETED ${protocol.id}/${attemptId}; selection awaits human review.`);
}

function reconstructEvidence(refs: EvidenceRef[], chunks: Map<string, DocumentationChunk>) {
  return refs.map((reference) => {
    const chunk = chunks.get(reference.chunkId);
    if (!chunk) throw new Error(`Frozen chunk ${reference.chunkId} is missing.`);
    if (sha256(chunk.content) !== reference.contentSha256) throw new Error(`Content hash mismatch for ${reference.chunkId}.`);
    const frozenDocument = `${chunk.title}\n${chunk.section}\n${chunk.sourceUrl}\n${chunk.content}`;
    if (sha256(frozenDocument) !== reference.promptDocumentSha256) throw new Error(`Prompt document hash mismatch for ${reference.chunkId}.`);
    return formatEvidence(reference, chunk);
  });
}

function buildPrompt(item: BenchmarkCase, prompt: Prompt, chunks: Map<string, DocumentationChunk>) {
  const evidence = item.evidence.map((reference) => formatEvidence(reference, chunks.get(reference.chunkId)!)).join(prompt.separator);
  return prompt.userTemplate.replace("{{QUESTION}}", item.question).replace("{{EVIDENCE}}", evidence || "No documentation excerpts supplied.");
}

function formatEvidence(reference: EvidenceRef, chunk: DocumentationChunk) {
  return `[S${reference.rank}]\nTitle: ${reference.title}\nSection: ${reference.section}\nURL: ${reference.sourceUrl}\nContent:\n${chunk.content}`;
}

function estimateExperiment(entries: Array<{ item: BenchmarkCase; prompt: string }>, candidates: GeneratorCandidate[]) {
  const callsPerCandidate = entries.filter((entry) => entry.item.generationPolicy === "invoke-generator").length;
  const estimatedInputTokens = entries.filter((entry) => entry.item.generationPolicy === "invoke-generator").reduce((sum, entry) => sum + Math.ceil(entry.prompt.length / 4), 0);
  return {
    callsPerCandidate,
    totalProviderCalls: callsPerCandidate * candidates.length,
    deterministicAbstentionsPerCandidate: entries.length - callsPerCandidate,
    estimatedInputTokensPerCandidate: estimatedInputTokens,
    conservativeMaximumCostUsd: round(candidates.reduce((sum, candidate) => sum + estimatedInputTokens / 1_000_000 * candidate.inputPriceUsdPerMillionTokens + callsPerCandidate * 900 / 1_000_000 * candidate.outputPriceUsdPerMillionTokens, 0)),
    note: "The maximum assumes every generated response consumes all 900 output tokens; actual billed cost should be lower and is recorded from provider usage when available.",
  };
}

function summarizeCandidate(candidate: GeneratorCandidate, outputs: CaseOutput[]) {
  const rows = outputs.filter((item) => item.candidateId === candidate.id);
  const generated = rows.filter((item) => item.result);
  const usage = generated.map((item) => item.result!.usage);
  const latencies = generated.map((item) => item.result!.latencyMs).sort((a, b) => a - b);
  return {
    candidateId: candidate.id,
    blindVariantId: blindId(candidate.id),
    generatedCases: generated.length,
    deterministicAbstentions: rows.filter((item) => item.generationPolicy === "deterministic-abstention").length,
    errors: rows.filter((item) => item.error).length,
    cacheHits: generated.filter((item) => item.result!.cacheHit).length,
    tokens: { prompt: sum(usage.map((item) => item.promptTokens)), completion: sum(usage.map((item) => item.completionTokens)), reasoning: sum(usage.map((item) => item.reasoningTokens)), total: sum(usage.map((item) => item.totalTokens)) },
    costUsd: round(sum(usage.map((item) => item.costUsd)), 6),
    latencyMs: { mean: round(sum(latencies) / Math.max(latencies.length, 1)), median: round(percentile(latencies, 0.5)), p95: round(percentile(latencies, 0.95)) },
  };
}

function renderSummary(artifact: { id: string; attemptId: string; summaries: ReturnType<typeof summarizeCandidate>[]; selectionStatus: string; testSplitTouched: boolean }) {
  return `# Grounded generator comparison outputs\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Split: **validation only**\n- Selection: **${artifact.selectionStatus}**\n- Judge: **disabled**\n\n| Blind variant | Generated | Errors | Cache hits | Input tokens | Output tokens | Reasoning tokens | Cost USD | Median ms | P95 ms |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${artifact.summaries.map((item) => `| ${item.blindVariantId} | ${item.generatedCases} | ${item.errors} | ${item.cacheHits} | ${item.tokens.prompt} | ${item.tokens.completion} | ${item.tokens.reasoning} | ${item.costUsd.toFixed(6)} | ${item.latencyMs.median.toFixed(2)} | ${item.latencyMs.p95.toFixed(2)} |`).join("\n")}\n\nNo quality winner is selected from latency or cost alone. Human review must be completed using the blinded package before judge calibration or test execution. The locked test split was touched: **${artifact.testSplitTouched ? "yes" : "no"}**.\n`;
}

async function writeTrackedReports(outputBase: string, artifact: Parameters<typeof renderSummary>[0] & { outputs: CaseOutput[]; candidates: GeneratorCandidate[]; createdAt: string; inputHashes: Record<string, string> }, benchmark: Benchmark, prepared: Array<{ item: BenchmarkCase; evidence: string[] }>) {
  const base = path.resolve(outputBase);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(`${base}.md`, renderSummary(artifact));
  await fs.writeFile(`${base}.json`, `${JSON.stringify({ schemaVersion: 1, createdAt: artifact.createdAt, inputHashes: artifact.inputHashes, candidates: artifact.candidates, summaries: artifact.summaries, outputs: artifact.outputs }, null, 2)}\n`);
  const calibration = new Set(benchmark.humanCalibration.caseIds);
  const cases = new Map(prepared.map((entry) => [entry.item.caseId, entry]));
  const rows = artifact.outputs.filter((item) => calibration.has(item.caseId)).map((output) => {
    const entry = cases.get(output.caseId)!;
    return [output.caseId, output.blindVariantId, entry.item.answerability, entry.item.language, entry.item.question, entry.item.expected.keyFacts.join(" | "), entry.evidence.join("\n\n---\n\n"), output.answer, "", "", "", "", ""];
  });
  const reviewPath = path.resolve("docs/evaluation/generation-human-review-v1.csv");
  const header = ["case_id", "blind_variant_id", "answerability", "language", "question", "expected_key_facts", "frozen_evidence", "candidate_answer", "key_fact_coverage_1_5", "groundedness_1_5", "citation_correctness_1_5", "abstention_correctness_1_5", "reviewer_notes"];
  await fs.writeFile(reviewPath, [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");
}

function validateProtocol(protocol: Protocol) {
  if (protocol.schemaVersion !== 1 || protocol.split !== "validation" || protocol.status !== "preregistered") throw new Error("Generation protocol must be preregistered on validation.");
  if (protocol.generatorCandidates.length !== 3) throw new Error("Exactly three generator candidates must be frozen.");
  if (protocol.generatorCandidates.some((item) => item.reasoningEffort !== "medium")) throw new Error("All candidates must use medium reasoning effort.");
}
function classifyAnswerStatus(answer: string) { return /cannot be fully determined|does not contain enough information|insufficient/i.test(answer) ? "insufficient_context" : "grounded"; }
function blindId(candidateId: string) { return `variant-${sha256(`retriq-generation-blinding-v1:${candidateId}`).slice(0, 8)}`; }
function parseArgs(args: string[]) { const value = (name: string, fallback: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }; return { protocol: value("--protocol", "docs/experiments/generation-models.v1.json"), estimateOnly: args.includes("--estimate-only"), allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report") }; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function percentile(values: number[], fraction: number) { return values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] : 0; }
function round(value: number, digits = 2) { return Number(value.toFixed(digits)); }
function csvCell(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

main().catch((error) => { console.error(error); process.exit(1); });
