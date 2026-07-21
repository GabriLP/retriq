import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import { parseCsv } from "../src/lib/evaluation/generation-review";
import { generateWithCandidate, type GeneratorCandidate, type GeneratorResult } from "../src/lib/rag/generator-providers";
import type { DocumentationChunk } from "../src/lib/rag/types";

type Variant = {
  id: string;
  maxOutputTokens: number;
  source: "frozen-baseline" | "new-generation";
};

type Protocol = {
  schemaVersion: 1;
  id: string;
  status: "preregistered" | "completed";
  split: "validation";
  benchmark: string;
  prompt: string;
  parentRun: string;
  baselineResults: string;
  humanReview: string;
  baselineCandidateId: string;
  candidate: GeneratorCandidate;
  variants: Variant[];
  controlledVariables: string[];
  decisionRule: Record<string, string>;
  reportOutput: string;
  reviewOutput: string;
};

type EvidenceRef = {
  rank: number;
  chunkId: string;
  title: string;
  section: string;
  sourceUrl: string;
  contentSha256: string;
  promptDocumentSha256: string;
};

type BenchmarkCase = {
  caseId: string;
  language: string;
  answerability: "answerable" | "unanswerable";
  question: string;
  expected: { keyFacts: string[] };
  evidence: EvidenceRef[];
  generationPolicy: "invoke-generator" | "deterministic-abstention";
};

type Benchmark = {
  schemaVersion: 1;
  id: string;
  split: "validation";
  source: { chunksSha256: string };
  humanCalibration: { caseIds: string[] };
  testSplit: { touched: boolean };
  cases: BenchmarkCase[];
};

type Prompt = {
  schemaVersion: 1;
  id: string;
  systemInstructions: string[];
  userTemplate: string;
  separator: string;
  generationControls: { temperature: number; maxOutputTokens: number };
};

type FrozenOutput = {
  caseId: string;
  candidateId: string;
  blindVariantId: string;
  answer: string;
  result: GeneratorResult | null;
  error: string | null;
};

type FrozenResults = {
  outputs: FrozenOutput[];
};

type BudgetOutput = {
  caseId: string;
  language: string;
  answer: string;
  responseHash: string;
  result: GeneratorResult | null;
  error: string | null;
};

type VariantSummary = {
  variantId: string;
  maxOutputTokens: number;
  generatedCases: number;
  errors: number;
  finishReasonCoverage: number;
  explicitMaxTokenStops: number;
  humanConfirmedGeneratorFailures: number;
  confirmedNearBudgetAbruptStops: number;
  tokens: { prompt: number; completion: number; reasoning: number; total: number };
  costUsd: number;
  latencyMs: { mean: number; median: number; p95: number };
  responseCharacters: { mean: number; median: number };
};

type BudgetArtifact = {
  id: string;
  attemptId: string;
  split: string;
  testSplitTouched: boolean;
  summaries: VariantSummary[];
  knownRegression: Record<string, unknown>;
  decision: { status: string; rationale: string };
  qualityStatus: string;
  limitations: string[];
  outputs: BudgetOutput[];
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
  const chunksRaw = await fs.readFile(path.resolve(protocol.parentRun, "chunks.json"), "utf8");
  const frozenRaw = await fs.readFile(path.resolve(protocol.baselineResults), "utf8");
  const frozen = JSON.parse(frozenRaw) as FrozenResults;
  const reviewRaw = await fs.readFile(path.resolve(protocol.humanReview), "utf8");

  if (benchmark.split !== "validation" || benchmark.testSplit.touched) {
    throw new Error("The output-budget experiment may use validation only while the test split remains untouched.");
  }
  if (sha256(chunksRaw) !== benchmark.source.chunksSha256) {
    throw new Error("Parent chunks hash differs from the frozen generation benchmark.");
  }

  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const cases = benchmark.cases.filter((item) => item.generationPolicy === "invoke-generator");
  const prepared = cases.map((item) => ({
    item,
    prompt: buildPrompt(item, prompt, chunksById),
    evidence: reconstructEvidence(item.evidence, chunksById),
  }));
  const baselineVariant = protocol.variants.find((item) => item.source === "frozen-baseline")!;
  const candidateVariant = protocol.variants.find((item) => item.source === "new-generation")!;
  const baselineOutputs = frozen.outputs.filter((item) => item.candidateId === protocol.baselineCandidateId && cases.some((candidate) => candidate.caseId === item.caseId));
  if (baselineOutputs.length !== cases.length) {
    throw new Error(`Expected ${cases.length} frozen baseline outputs, found ${baselineOutputs.length}.`);
  }

  const estimate = estimateExperiment(prepared, protocol.candidate, candidateVariant.maxOutputTokens);
  if (!options.allowProviderRequests) {
    console.log(JSON.stringify({
      protocol: protocol.id,
      split: protocol.split,
      changedVariable: "maxOutputTokens",
      baseline: baselineVariant.maxOutputTokens,
      candidate: candidateVariant.maxOutputTokens,
      testSplitTouched: false,
      estimate,
    }, null, 2));
    return;
  }

  const outputs: BudgetOutput[] = [];
  const startedAt = performance.now();
  for (const entry of prepared) {
    try {
      const result = await generateWithCandidate({
        candidate: protocol.candidate,
        systemInstruction: prompt.systemInstructions.join("\n"),
        userPrompt: entry.prompt,
        temperature: prompt.generationControls.temperature,
        maxOutputTokens: candidateVariant.maxOutputTokens,
        allowProviderRequests: true,
      });
      outputs.push({
        caseId: entry.item.caseId,
        language: entry.item.language,
        answer: result.answer,
        responseHash: sha256(result.answer),
        result,
        error: null,
      });
      console.log(`${entry.item.caseId}: ${result.cacheHit ? "cache" : `${result.latencyMs} ms`} (${result.finishReason ?? "unknown stop"})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputs.push({ caseId: entry.item.caseId, language: entry.item.language, answer: "", responseHash: sha256(""), result: null, error: message });
      console.error(`${entry.item.caseId}: ${message}`);
    }
  }

  const reviewRows = parseCsv(reviewRaw).rows;
  const humanFailures = new Set(
    reviewRows
      .filter((row) => row.generator_failure_0_1 === "1" && row.blind_variant_id === baselineOutputs[0]?.blindVariantId)
      .map((row) => row.case_id),
  );
  const baselineSummary = summarizeFrozen(baselineVariant, baselineOutputs, humanFailures);
  const candidateSummary = summarizeGenerated(candidateVariant, outputs);
  const knownRegressionCaseId = "rust-ownership-move-clone-001";
  const baselineRegression = baselineOutputs.find((item) => item.caseId === knownRegressionCaseId);
  const candidateRegression = outputs.find((item) => item.caseId === knownRegressionCaseId);
  const decision = decide(candidateSummary, candidateRegression);
  const createdAt = new Date().toISOString();
  const attemptId = createdAt.replace(/[-:.TZ]/g, "").slice(0, 17);
  const provenance = readCodeProvenance();
  const artifact = {
    schemaVersion: 1,
    id: protocol.id,
    attemptId,
    createdAt,
    split: "validation",
    testSplitTouched: false,
    inputHashes: {
      protocol: sha256(protocolRaw),
      benchmark: sha256(benchmarkRaw),
      prompt: sha256(promptRaw),
      chunks: sha256(chunksRaw),
      baselineResults: sha256(frozenRaw),
      humanReview: sha256(reviewRaw),
    },
    code: provenance,
    controls: protocol.controlledVariables,
    estimate,
    summaries: [baselineSummary, candidateSummary],
    knownRegression: {
      caseId: knownRegressionCaseId,
      baselineAnswerEnd: baselineRegression?.answer.slice(-240) ?? null,
      baselineBudgetTokens: baselineRegression?.result ? googleBudgetTokens(baselineRegression.result) : null,
      candidateAnswerEnd: candidateRegression?.answer.slice(-240) ?? null,
      candidateFinishReason: candidateRegression?.result?.finishReason ?? null,
      candidateTruncated: candidateRegression?.result?.truncated ?? null,
    },
    decision,
    qualityStatus: "pending-blinded-human-review-or-calibrated-judge",
    limitations: [
      "Legacy provider finish reasons were not stored, so its truncation count is a confirmed lower bound based on human failure labels, near-budget usage, and an abrupt ending.",
      "Temperature zero does not guarantee byte-identical regeneration across provider revisions.",
      "Completion reliability, cost, and latency do not establish answer quality.",
      "The locked test split was not accessed.",
    ],
    outputs,
    elapsedMs: Math.round(performance.now() - startedAt),
  };

  const attemptDirectory = path.resolve("data/experiments", protocol.id, attemptId);
  await fs.mkdir(attemptDirectory, { recursive: true });
  await fs.writeFile(path.join(attemptDirectory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(attemptDirectory, "summary.md"), renderMarkdown(artifact));
  if (options.writeReport) {
    await writeTrackedReports(protocol, artifact, benchmark, prepared, baselineOutputs);
  }
  console.log(`COMPLETED ${protocol.id}/${attemptId}: ${decision.status}`);
}

function validateProtocol(protocol: Protocol) {
  if (protocol.schemaVersion !== 1 || protocol.status !== "preregistered" || protocol.split !== "validation") {
    throw new Error("Generation output-budget protocol must be preregistered on validation.");
  }
  if (protocol.variants.length !== 2 || protocol.variants.filter((item) => item.source === "frozen-baseline").length !== 1 || protocol.variants.filter((item) => item.source === "new-generation").length !== 1) {
    throw new Error("Protocol must define one frozen baseline and one new-generation variant.");
  }
  if (protocol.candidate.provider !== "google" || protocol.candidate.reasoningEffort !== "low") {
    throw new Error("This controlled regression is preregistered for direct Gemini at low reasoning effort.");
  }
}

function reconstructEvidence(refs: EvidenceRef[], chunks: Map<string, DocumentationChunk>) {
  return refs.map((reference) => formatEvidence(reference, checkedChunk(reference, chunks)));
}

function buildPrompt(item: BenchmarkCase, prompt: Prompt, chunks: Map<string, DocumentationChunk>) {
  const evidence = item.evidence.map((reference) => formatEvidence(reference, checkedChunk(reference, chunks))).join(prompt.separator);
  return prompt.userTemplate.replace("{{QUESTION}}", item.question).replace("{{EVIDENCE}}", evidence);
}

function checkedChunk(reference: EvidenceRef, chunks: Map<string, DocumentationChunk>) {
  const chunk = chunks.get(reference.chunkId);
  if (!chunk) throw new Error(`Frozen chunk ${reference.chunkId} is missing.`);
  if (sha256(chunk.content) !== reference.contentSha256) throw new Error(`Content hash mismatch for ${reference.chunkId}.`);
  if (sha256(`${chunk.title}\n${chunk.section}\n${chunk.sourceUrl}\n${chunk.content}`) !== reference.promptDocumentSha256) {
    throw new Error(`Prompt-document hash mismatch for ${reference.chunkId}.`);
  }
  return chunk;
}

function formatEvidence(reference: EvidenceRef, chunk: DocumentationChunk) {
  return `[S${reference.rank}]\nTitle: ${reference.title}\nSection: ${reference.section}\nURL: ${reference.sourceUrl}\nContent:\n${chunk.content}`;
}

function estimateExperiment(entries: Array<{ prompt: string }>, candidate: GeneratorCandidate, maxOutputTokens: number) {
  const estimatedInputTokens = sum(entries.map((entry) => Math.ceil(entry.prompt.length / 4)));
  return {
    providerCalls: entries.length,
    estimatedInputTokens,
    maximumOutputTokens: entries.length * maxOutputTokens,
    conservativeMaximumCostUsd: round(
      estimatedInputTokens / 1_000_000 * candidate.inputPriceUsdPerMillionTokens
      + entries.length * maxOutputTokens / 1_000_000 * candidate.outputPriceUsdPerMillionTokens,
      6,
    ),
    note: "This is a conservative ceiling, not a billing prediction. Actual cost uses provider token metadata and successful responses are content-addressed in the generation cache.",
  };
}

function summarizeFrozen(variant: Variant, outputs: FrozenOutput[], humanFailures: Set<string>): VariantSummary {
  const results = outputs.flatMap((item) => item.result ? [item.result] : []);
  const nearBudgetAbrupt = outputs.filter((item) => {
    if (!item.result || !humanFailures.has(item.caseId)) return false;
    return googleBudgetTokens(item.result) >= variant.maxOutputTokens * 0.98 && hasAbruptEnding(item.answer);
  }).length;
  return summarize(variant, results, outputs.map((item) => item.answer), outputs.filter((item) => item.error).length, {
    explicitMaxTokenStops: results.filter((item) => item.truncated === true).length,
    humanConfirmedGeneratorFailures: humanFailures.size,
    confirmedNearBudgetAbruptStops: nearBudgetAbrupt,
  });
}

function summarizeGenerated(variant: Variant, outputs: BudgetOutput[]): VariantSummary {
  const results = outputs.flatMap((item) => item.result ? [item.result] : []);
  return summarize(variant, results, outputs.map((item) => item.answer), outputs.filter((item) => item.error).length, {
    explicitMaxTokenStops: results.filter((item) => item.truncated === true).length,
    humanConfirmedGeneratorFailures: 0,
    confirmedNearBudgetAbruptStops: results.filter((item, index) => item.truncated === true && hasAbruptEnding(outputs[index]?.answer ?? "")).length,
  });
}

function summarize(variant: Variant, results: GeneratorResult[], answers: string[], errors: number, stopCounts: { explicitMaxTokenStops: number; humanConfirmedGeneratorFailures: number; confirmedNearBudgetAbruptStops: number }): VariantSummary {
  const latencies = results.map((item) => item.latencyMs).sort((left, right) => left - right);
  const lengths = answers.filter(Boolean).map((item) => item.length).sort((left, right) => left - right);
  return {
    variantId: variant.id,
    maxOutputTokens: variant.maxOutputTokens,
    generatedCases: results.length,
    errors,
    finishReasonCoverage: results.filter((item) => typeof item.finishReason === "string").length,
    ...stopCounts,
    tokens: {
      prompt: sum(results.map((item) => item.usage.promptTokens)),
      completion: sum(results.map((item) => item.usage.completionTokens)),
      reasoning: sum(results.map((item) => item.usage.reasoningTokens)),
      total: sum(results.map((item) => item.usage.totalTokens)),
    },
    costUsd: round(sum(results.map((item) => item.usage.costUsd)), 6),
    latencyMs: { mean: round(mean(latencies)), median: round(percentile(latencies, 0.5)), p95: round(percentile(latencies, 0.95)) },
    responseCharacters: { mean: round(mean(lengths)), median: round(percentile(lengths, 0.5)) },
  };
}

function decide(summary: VariantSummary, regression: BudgetOutput | undefined) {
  const regressionComplete = Boolean(regression?.result && regression.result.truncated === false && !hasAbruptEnding(regression.answer));
  const accepted = summary.errors === 0 && summary.explicitMaxTokenStops === 0 && summary.finishReasonCoverage === summary.generatedCases && regressionComplete;
  return {
    status: accepted ? "accept-2048-for-runtime-reliability" : "needs-review",
    reliabilityAccepted: accepted,
    knownRegressionComplete: regressionComplete,
    qualitySelectionMade: false,
    rationale: accepted
      ? "All validation calls stopped naturally, the known 900-token regression completed, and no operational errors occurred. Quality remains a separate pending assessment."
      : "At least one preregistered reliability guardrail failed; do not adopt the larger budget without inspection.",
  };
}

async function writeTrackedReports(protocol: Protocol, artifact: BudgetArtifact, benchmark: Benchmark, prepared: Array<{ item: BenchmarkCase; evidence: string[] }>, baselineOutputs: FrozenOutput[]) {
  const base = path.resolve(protocol.reportOutput);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(`${base}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${base}.md`, renderMarkdown(artifact));
  await fs.writeFile(`${base}.csv`, renderCsv(artifact.summaries));

  const calibration = new Set(benchmark.humanCalibration.caseIds);
  const baselineByCase = new Map(baselineOutputs.map((item) => [item.caseId, item]));
  const candidateByCase = new Map(artifact.outputs.map((item) => [item.caseId, item]));
  const rows = prepared.filter((entry) => calibration.has(entry.item.caseId)).flatMap((entry) => {
    const baseline = baselineByCase.get(entry.item.caseId);
    const candidate = candidateByCase.get(entry.item.caseId);
    return [
      reviewRow(entry, "budget-blind-a", baseline?.answer ?? ""),
      reviewRow(entry, "budget-blind-b", candidate?.answer ?? ""),
    ];
  });
  const header = ["case_id", "blind_budget_variant", "language", "question", "expected_key_facts", "frozen_evidence", "candidate_answer", "complete_0_1", "groundedness_0_4", "key_fact_coverage_0_4", "citation_correctness_0_4", "citation_completeness_0_4", "directness_0_2", "reviewer_notes"];
  await fs.writeFile(path.resolve(protocol.reviewOutput), [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");
}

function reviewRow(entry: { item: BenchmarkCase; evidence: string[] }, blindVariant: string, answer: string) {
  return [entry.item.caseId, blindVariant, entry.item.language, entry.item.question, entry.item.expected.keyFacts.join(" | "), entry.evidence.join("\n\n---\n\n"), answer, "", "", "", "", "", "", ""];
}

function renderMarkdown(artifact: BudgetArtifact) {
  const rows = artifact.summaries.map((item) => `| ${item.variantId} | ${item.maxOutputTokens} | ${item.generatedCases} | ${item.errors} | ${item.finishReasonCoverage} | ${item.explicitMaxTokenStops} | ${item.confirmedNearBudgetAbruptStops} | ${item.tokens.completion} | ${item.tokens.reasoning} | ${item.costUsd.toFixed(6)} | ${item.latencyMs.median.toFixed(2)} | ${item.responseCharacters.median.toFixed(0)} |`).join("\n");
  return `# Generation output-budget comparison\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Split: **validation only**\n- Decision: **${artifact.decision.status}**\n- Quality status: **${artifact.qualityStatus}**\n- Locked test touched: **${artifact.testSplitTouched ? "yes" : "no"}**\n\n| Variant | Max tokens | Generated | Errors | Finish reasons | MAX_TOKENS | Confirmed near-budget abrupt stops | Completion tokens | Reasoning tokens | Cost USD | Median ms | Median chars |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Known regression\n\n\`${String(artifact.knownRegression.caseId)}\` is the human-confirmed 900-token Gemini failure. Its candidate stop reason is \`${String(artifact.knownRegression.candidateFinishReason)}\` and candidate truncation flag is \`${String(artifact.knownRegression.candidateTruncated)}\`.\n\n## Decision rationale\n\n${artifact.decision.rationale}\n\nCompletion reliability does not establish answer quality. The generated blinded review package must be used for human assessment or retained until an independently calibrated judge is available.\n\n## Limitations\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

function renderCsv(summaries: VariantSummary[]) {
  const header = ["variant", "max_output_tokens", "generated_cases", "errors", "finish_reason_coverage", "explicit_max_token_stops", "human_generator_failures", "confirmed_near_budget_abrupt_stops", "prompt_tokens", "completion_tokens", "reasoning_tokens", "total_tokens", "cost_usd", "mean_latency_ms", "median_latency_ms", "p95_latency_ms", "mean_response_characters", "median_response_characters"];
  const rows = summaries.map((item) => [item.variantId, item.maxOutputTokens, item.generatedCases, item.errors, item.finishReasonCoverage, item.explicitMaxTokenStops, item.humanConfirmedGeneratorFailures, item.confirmedNearBudgetAbruptStops, item.tokens.prompt, item.tokens.completion, item.tokens.reasoning, item.tokens.total, item.costUsd, item.latencyMs.mean, item.latencyMs.median, item.latencyMs.p95, item.responseCharacters.mean, item.responseCharacters.median]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function readCodeProvenance() {
  const gitCommit = runGit(["rev-parse", "HEAD"]) || "unknown";
  const status = runGit(["status", "--porcelain", "--", "src", "scripts", "docs/experiments", "docs/evaluation", "package.json", "package-lock.json"]);
  const diff = runGit(["diff", "--binary", "--", "src", "scripts", "docs/experiments", "docs/evaluation", "package.json", "package-lock.json"]);
  return { gitCommit, dirty: Boolean(status), gitDiffSha256: sha256(diff) };
}

function runGit(args: string[]) {
  try { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
  catch { return ""; }
}

function googleBudgetTokens(result: GeneratorResult) {
  return result.usage.completionTokens + result.usage.reasoningTokens;
}

function hasAbruptEnding(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) return true;
  return !/[.!?\]})`_*]$/.test(trimmed);
}

function parseArgs(args: string[]) {
  const value = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  return {
    protocol: value("--protocol", "docs/experiments/generation-output-budget.v1.json"),
    allowProviderRequests: args.includes("--allow-provider-requests"),
    writeReport: args.includes("--write-report"),
  };
}

function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function mean(values: number[]) { return values.length ? sum(values) / values.length : 0; }
function percentile(values: number[], fraction: number) { return values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] : 0; }
function round(value: number, digits = 2) { return Number(value.toFixed(digits)); }
function csvCell(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

main().catch((error) => { console.error(error); process.exit(1); });
