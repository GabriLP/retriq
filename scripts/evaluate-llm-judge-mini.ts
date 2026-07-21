import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv, type ReviewCsvRow } from "../src/lib/evaluation/generation-review";
import { agreement, mean, meanAbsoluteError, normalizedQuality, passesQuality, quadraticWeightedKappa, spearmanCorrelation, type JudgeLabel } from "../src/lib/evaluation/judge-metrics";
import { buildJudgeResponseSchema, judgeCacheKey, judgeWithOpenRouter, type JudgeCandidate, type JudgeOutput, type JudgeResult } from "../src/lib/evaluation/judge-provider";

type PromptArtifact = { systemInstruction: string; scoreAnchors: Record<string, unknown>; responseSchema: Record<string, unknown> };
type Protocol = {
  id: string;
  judge: JudgeCandidate & { maxCompletionTokens: number };
  acceptanceCriteria: {
    minimumPooledCoreQuadraticWeightedKappa: number;
    minimumAnswerableQualitySpearman: number;
    minimumBinaryPassAgreement: number;
    requiredStructuredValidityRate: number;
    requiredAnswerabilityConsistencyRate: number;
    maximumProviderErrors: number;
  };
  costGuardrail: { hardStopUsd: number };
  limitations: string[];
};
type SplitManifest = { sourceSha256: string; assignments: Array<{ rowId: string; split: "calibration" | "audit" }> };
type Ledger = {
  schemaVersion: 1; experimentId: string; resumptions: number; providerRequests: number; validResponses: number;
  invalidResponses: number; invalidResponseDetails: Array<{ afterValidResponse: number; reason: string }>;
  validResponseCostUsd: number; invalidResponseCost: string; complete: boolean;
};
type Evaluated = { row: ReviewCsvRow; rowId: string; human: JudgeLabel; judge: JudgeLabel; result: JudgeResult };

const coreDimensions = ["groundedness", "keyFactCoverage", "citationCorrectness", "citationCompleteness"] as const;
const allDimensions = [...coreDimensions, "directness"] as const;
const flagDimensions = ["criticalUnsupportedClaim", "contradictsEvidence", "invalidCitationLabel", "generatorFailure"] as const;

async function main() {
  loadLocalEnv();
  const planOnly = process.argv.includes("--plan");
  const allowProviderRequests = process.argv.includes("--allow-provider-requests");
  const inputPath = path.resolve("docs/evaluation/generation-human-review-v1.completed.csv");
  const promptPath = path.resolve("docs/evaluation/llm-judge-prompt.v1.json");
  const splitPath = path.resolve("docs/evaluation/llm-judge-split.v1.json");
  const protocolPath = path.resolve("docs/experiments/llm-judge-calibration.v2.json");
  const ledgerPath = path.resolve("docs/experiment-results/llm-judge-calibration-v2-execution-ledger.json");
  const outputBase = path.resolve("docs/experiment-results/llm-judge-calibration-v2-validation");
  const predictionsPath = path.resolve("docs/experiment-results/llm-judge-calibration-v2-predictions.csv");
  const inputText = await fs.readFile(inputPath, "utf8");
  const { rows } = parseCsv(inputText);
  const prompt = JSON.parse(await fs.readFile(promptPath, "utf8")) as PromptArtifact;
  const protocol = JSON.parse(await fs.readFile(protocolPath, "utf8")) as Protocol;
  const split = JSON.parse(await fs.readFile(splitPath, "utf8")) as SplitManifest;
  if (sha256(inputText) !== split.sourceSha256) throw new Error("Human-reference CSV no longer matches the frozen split manifest.");
  const splitByRow = new Map(split.assignments.map((item) => [item.rowId, item.split]));
  validateRows(rows, splitByRow);
  const calibrationRows = rows.filter((row) => splitByRow.get(rowId(row)) === "calibration");
  if (calibrationRows.length !== 48) throw new Error(`Expected 48 calibration rows, received ${calibrationRows.length}.`);

  const candidate: JudgeCandidate = {
    id: protocol.judge.id, model: protocol.judge.model, expectedResponseModel: protocol.judge.expectedResponseModel,
    expectedResponseProvider: protocol.judge.expectedResponseProvider, providerOrder: protocol.judge.providerOrder,
    reasoningEffort: protocol.judge.reasoningEffort,
    inputPriceUsdPerMillionTokens: protocol.judge.inputPriceUsdPerMillionTokens,
    outputPriceUsdPerMillionTokens: protocol.judge.outputPriceUsdPerMillionTokens,
  };
  const systemInstruction = `${prompt.systemInstruction}\n\nScore anchors:\n${JSON.stringify(prompt.scoreAnchors, null, 2)}`;
  const tasks = calibrationRows.map((row) => {
    const userPrompt = buildUserPrompt(row);
    const options = { candidate, systemInstruction, userPrompt, schema: buildJudgeResponseSchema(prompt.responseSchema, row.answerability as "answerable" | "unanswerable"), maxOutputTokens: protocol.judge.maxCompletionTokens };
    return { row, rowId: rowId(row), cacheKey: judgeCacheKey(options), options };
  });
  const uniqueTasks = [...new Map(tasks.map((task) => [task.cacheKey, task])).values()];
  console.log(`GPT-5.4 Mini calibration: ${calibrationRows.length} rows, ${uniqueTasks.length} unique requests, audit rows 0.`);
  if (planOnly) return;
  if (!allowProviderRequests) throw new Error("Provider requests are disabled. Re-run with --allow-provider-requests after committing the preregistration.");

  const existingLedger = await readLedger(ledgerPath);
  const ledger: Ledger = existingLedger ?? {
    schemaVersion: 1, experimentId: protocol.id, resumptions: 0, providerRequests: 0, validResponses: 0,
    invalidResponses: 0, invalidResponseDetails: [], validResponseCostUsd: 0,
    invalidResponseCost: "Unavailable when a rejected response does not expose validated usage.", complete: false,
  };
  if (existingLedger && !existingLedger.complete) ledger.resumptions += 1;
  const resultByKey = new Map<string, JudgeResult>();
  for (let index = 0; index < uniqueTasks.length; index += 1) {
    const task = uniqueTasks[index];
    if (ledger.validResponseCostUsd >= protocol.costGuardrail.hardStopUsd) throw new Error(`Cost guardrail reached $${protocol.costGuardrail.hardStopUsd.toFixed(2)}.`);
    const result = await executeTask(task.options, ledger, ledgerPath);
    resultByKey.set(task.cacheKey, result);
    console.log(`[${index + 1}/${uniqueTasks.length}] ${task.rowId} ${result.cacheHit ? "cache" : "provider"} $${result.usage.costUsd.toFixed(6)}`);
  }

  const evaluated: Evaluated[] = tasks.map((task) => {
    const result = resultByKey.get(task.cacheKey)!;
    if (result.output.answerability !== task.row.answerability) throw new Error(`${task.rowId}: answerability mismatch.`);
    return { row: task.row, rowId: task.rowId, human: humanLabel(task.row), judge: outputLabel(result.output), result };
  });
  const metrics = summarize(evaluated, protocol, ledger.invalidResponses);
  const checks = acceptance(metrics, protocol);
  const uniqueResults = [...resultByKey.values()];
  ledger.complete = true;
  await writeJson(ledgerPath, ledger);
  const artifact = {
    schemaVersion: 1, id: "llm-judge-calibration-v2-validation", createdAt: new Date().toISOString(),
    protocol: "docs/experiments/llm-judge-calibration.v2.json", protocolSha256: sha256(await fs.readFile(protocolPath, "utf8")),
    prompt: "docs/evaluation/llm-judge-prompt.v1.json", promptSha256: sha256(await fs.readFile(promptPath, "utf8")),
    humanReviewSha256: sha256(inputText), split: "calibration-only", oldAuditTouched: false, lockedGenerationTestTouched: false,
    judge: candidate,
    execution: {
      rows: evaluated.length, uniqueRequests: uniqueTasks.length, deduplicatedRows: evaluated.length - uniqueTasks.length,
      providerCallsThisRun: uniqueResults.filter((result) => !result.cacheHit).length,
      cacheHitsThisRun: uniqueResults.filter((result) => result.cacheHit).length,
      historicalProviderRequests: ledger.providerRequests, historicalValidResponses: ledger.validResponses,
      historicalInvalidResponses: ledger.invalidResponses, resumptions: ledger.resumptions,
      responseModels: [...new Set(uniqueResults.map((result) => result.responseModel))],
      responseProviders: [...new Set(uniqueResults.map((result) => result.responseProvider))],
      finishReasons: frequencies(uniqueResults.map((result) => result.finishReason ?? "unknown")),
      promptTokens: sum(uniqueResults.map((result) => result.usage.promptTokens)),
      completionTokens: sum(uniqueResults.map((result) => result.usage.completionTokens)),
      reasoningTokens: sum(uniqueResults.map((result) => result.usage.reasoningTokens)),
      totalTokens: sum(uniqueResults.map((result) => result.usage.totalTokens)),
      observedCostUsd: sum(uniqueResults.map((result) => result.usage.costUsd)),
      latencyMs: distribution(uniqueResults.map((result) => result.latencyMs)),
    },
    metrics, acceptance: { ...checks, decision: checks.allPassed ? "PASS: eligible for a newly preregistered untouched audit." : "FAIL: keep automatic judging disabled; do not access an audit set." },
    limitations: protocol.limitations,
  };
  await writeJson(`${outputBase}.json`, artifact);
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(artifact));
  await fs.writeFile(predictionsPath, predictionsCsv(evaluated));
  console.log(`Wrote ${path.relative(process.cwd(), outputBase)}.{json,md} and calibration predictions.`);
  console.log(`Acceptance: ${checks.allPassed ? "PASS" : "FAIL"}. Cost: $${artifact.execution.observedCostUsd.toFixed(6)}.`);
}

async function executeTask(options: Parameters<typeof judgeWithOpenRouter>[0], ledger: Ledger, ledgerPath: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await judgeWithOpenRouter({ ...options, allowProviderRequests: true });
      if (!result.cacheHit) {
        ledger.providerRequests += 1; ledger.validResponses += 1; ledger.validResponseCostUsd += result.usage.costUsd;
        await writeJson(ledgerPath, ledger);
      }
      return result;
    } catch (error) {
      ledger.providerRequests += 1; ledger.invalidResponses += 1;
      ledger.invalidResponseDetails.push({ afterValidResponse: ledger.validResponses, reason: String(error) });
      await writeJson(ledgerPath, ledger);
      if (attempt === 3 || !/OpenRouter (408|409|429|5\d\d)|fetch failed|timeout/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw new Error("Unreachable retry state.");
}

function summarize(items: Evaluated[], protocol: Protocol, providerErrors: number) {
  const answerable = items.filter((item) => item.human.answerability === "answerable");
  const humanCore = answerable.flatMap((item) => coreDimensions.map((key) => item.human[key]!));
  const judgeCore = answerable.flatMap((item) => coreDimensions.map((key) => item.judge[key]!));
  const humanPass = items.map((item) => passesQuality(item.human));
  const judgePass = items.map((item) => passesQuality(item.judge));
  return {
    rows: items.length, answerableRows: answerable.length, unanswerableRows: items.length - answerable.length,
    primary: {
      pooledCoreQuadraticWeightedKappa: quadraticWeightedKappa(humanCore, judgeCore, 4),
      answerableQualitySpearman: spearmanCorrelation(answerable.map((item) => normalizedQuality(item.human)), answerable.map((item) => normalizedQuality(item.judge))),
      binaryPassAgreement: agreement(humanPass, judgePass),
    },
    scoreBias: {
      humanMeanQuality: mean(answerable.map((item) => normalizedQuality(item.human))),
      judgeMeanQuality: mean(answerable.map((item) => normalizedQuality(item.judge))),
      judgeMinusHumanMeanQuality: mean(answerable.map((item) => normalizedQuality(item.judge) - normalizedQuality(item.human))),
    },
    dimensions: Object.fromEntries(allDimensions.map((key) => {
      const reference = answerable.map((item) => item.human[key]!); const predicted = answerable.map((item) => item.judge[key]!);
      return [key, { quadraticWeightedKappa: quadraticWeightedKappa(reference, predicted, key === "directness" ? 2 : 4), meanAbsoluteError: meanAbsoluteError(reference, predicted), exactAgreement: mean(reference.map((value, index) => Number(value === predicted[index]))), withinOneAgreement: mean(reference.map((value, index) => Number(Math.abs(value - predicted[index]) <= 1))) }];
    })),
    correctAbstentionAgreement: agreement(items.filter((item) => item.human.answerability === "unanswerable").map((item) => item.human.correctAbstention === 1), items.filter((item) => item.human.answerability === "unanswerable").map((item) => item.judge.correctAbstention === 1)),
    flags: Object.fromEntries(flagDimensions.map((key) => [key, { agreement: agreement(items.map((item) => item.human[key] === 1), items.map((item) => item.judge[key] === 1)), humanPositiveRate: mean(items.map((item) => item.human[key])), judgePositiveRate: mean(items.map((item) => item.judge[key])) }])),
    passConfusion: confusion(humanPass, judgePass), structuredValidityRate: 1, answerabilityConsistencyRate: 1, providerErrors,
    thresholds: protocol.acceptanceCriteria,
  };
}

function acceptance(metrics: ReturnType<typeof summarize>, protocol: Protocol) {
  const threshold = protocol.acceptanceCriteria;
  const checks = {
    pooledCoreQuadraticWeightedKappa: metrics.primary.pooledCoreQuadraticWeightedKappa >= threshold.minimumPooledCoreQuadraticWeightedKappa,
    answerableQualitySpearman: metrics.primary.answerableQualitySpearman !== null && metrics.primary.answerableQualitySpearman >= threshold.minimumAnswerableQualitySpearman,
    binaryPassAgreement: metrics.primary.binaryPassAgreement >= threshold.minimumBinaryPassAgreement,
    structuredValidityRate: metrics.structuredValidityRate >= threshold.requiredStructuredValidityRate,
    answerabilityConsistencyRate: metrics.answerabilityConsistencyRate >= threshold.requiredAnswerabilityConsistencyRate,
    providerErrors: metrics.providerErrors <= threshold.maximumProviderErrors,
  };
  return { checks, allPassed: Object.values(checks).every(Boolean) };
}

function predictionsCsv(items: Evaluated[]) {
  const rows = items.map((item) => ({ row_id: item.rowId, case_id: item.row.case_id, blind_variant_id: item.row.blind_variant_id, answerability: item.row.answerability, human_quality: normalizedQuality(item.human).toFixed(4), judge_quality: normalizedQuality(item.judge).toFixed(4), human_pass: String(passesQuality(item.human)), judge_pass: String(passesQuality(item.judge)), human_scores: compactScores(item.human), judge_scores: compactScores(item.judge), human_flags: compactFlags(item.human), judge_flags: compactFlags(item.judge), judge_rationale: item.result.output.rationale }));
  const headers = Object.keys(rows[0]) as Array<keyof typeof rows[number]>;
  const cell = (value: string) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header]))].map((row) => row.map((value) => cell(String(value))).join(",")).join("\n")}\n`;
}

function renderMarkdown(artifact: { judge: JudgeCandidate; execution: { rows: number; uniqueRequests: number; observedCostUsd: number; historicalInvalidResponses: number }; metrics: ReturnType<typeof summarize>; acceptance: ReturnType<typeof acceptance> & { decision: string }; limitations: string[] }) {
  const metrics = artifact.metrics;
  return `# LLM judge calibration v2\n\n- Judge: **${artifact.judge.model}**, medium reasoning, OpenAI pinned through OpenRouter\n- Scope: **calibration only** (${artifact.execution.rows} rows; ${artifact.execution.uniqueRequests} unique inputs)\n- Old audit touched: **no**\n- Locked generation test touched: **no**\n- Observed cost: **$${artifact.execution.observedCostUsd.toFixed(6)}**\n\n| Metric | Result | Threshold | Pass |\n|---|---:|---:|---|\n| Pooled core QWK | ${metrics.primary.pooledCoreQuadraticWeightedKappa.toFixed(4)} | 0.6000 | ${artifact.acceptance.checks.pooledCoreQuadraticWeightedKappa ? "yes" : "no"} |\n| Quality Spearman | ${metrics.primary.answerableQualitySpearman?.toFixed(4) ?? "n/a"} | 0.7000 | ${artifact.acceptance.checks.answerableQualitySpearman ? "yes" : "no"} |\n| Binary pass agreement | ${metrics.primary.binaryPassAgreement.toFixed(4)} | 0.8000 | ${artifact.acceptance.checks.binaryPassAgreement ? "yes" : "no"} |\n| Provider errors | ${artifact.execution.historicalInvalidResponses} | 0 | ${artifact.acceptance.checks.providerErrors ? "yes" : "no"} |\n\n## Decision\n\n**${artifact.acceptance.allPassed ? "PASS" : "FAIL"}** — ${artifact.acceptance.decision}\n\n## Interpretation limits\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

function buildUserPrompt(row: ReviewCsvRow) { return `Task type: ${row.answerability}\nLanguage: ${row.language}\n\nQuestion:\n${row.question}\n\nExpected key facts:\n${row.expected_key_facts || "(none; the benchmark expects abstention)"}\n\nFrozen evidence:\n${row.frozen_evidence || "(no evidence passed the retrieval acceptance gate)"}\n\nCandidate answer:\n${row.candidate_answer}`; }
function humanLabel(row: ReviewCsvRow): JudgeLabel { const n = (column: string) => row[column] === "" ? null : Number(row[column]); return { answerability: row.answerability as JudgeLabel["answerability"], groundedness: n("groundedness_0_4"), keyFactCoverage: n("key_fact_coverage_0_4"), citationCorrectness: n("citation_correctness_0_4"), citationCompleteness: n("citation_completeness_0_4"), directness: n("directness_0_2"), correctAbstention: n("correct_abstention_0_1"), criticalUnsupportedClaim: Number(row.critical_unsupported_claim_0_1), contradictsEvidence: Number(row.contradicts_evidence_0_1), invalidCitationLabel: Number(row.invalid_citation_label_0_1), generatorFailure: Number(row.generator_failure_0_1) }; }
function outputLabel(output: JudgeOutput): JudgeLabel { return { answerability: output.answerability, ...output.scores, criticalUnsupportedClaim: Number(output.flags.criticalUnsupportedClaim), contradictsEvidence: Number(output.flags.contradictsEvidence), invalidCitationLabel: Number(output.flags.invalidCitationLabel), generatorFailure: Number(output.flags.generatorFailure) }; }
function validateRows(rows: ReviewCsvRow[], splitByRow: Map<string, "calibration" | "audit">) { if (rows.length !== 72 || splitByRow.size !== 72) throw new Error("Expected 72 rows and split assignments."); for (const row of rows) { if (!splitByRow.has(rowId(row))) throw new Error(`Missing split for ${rowId(row)}.`); if (row.review_status !== "human-reviewed") throw new Error(`${rowId(row)} is not human reviewed.`); humanLabel(row); } }
function rowId(row: ReviewCsvRow) { return `${row.case_id}::${row.blind_variant_id}`; }
function compactScores(label: JudgeLabel) { return label.answerability === "answerable" ? `G${label.groundedness}/K${label.keyFactCoverage}/CC${label.citationCorrectness}/CP${label.citationCompleteness}/D${label.directness}` : `A${label.correctAbstention}`; }
function compactFlags(label: JudgeLabel) { return `U${label.criticalUnsupportedClaim}/C${label.contradictsEvidence}/I${label.invalidCitationLabel}/F${label.generatorFailure}`; }
function confusion(reference: boolean[], predicted: boolean[]) { return { truePositive: reference.filter((value, index) => value && predicted[index]).length, trueNegative: reference.filter((value, index) => !value && !predicted[index]).length, falsePositive: reference.filter((value, index) => !value && predicted[index]).length, falseNegative: reference.filter((value, index) => value && !predicted[index]).length }; }
function frequencies(values: string[]) { return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length])); }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function distribution(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return { mean: mean(values), median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }; }
function percentile(sorted: number[], ratio: number) { return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]; }
function sha256(value: string | Buffer) { return crypto.createHash("sha256").update(value).digest("hex"); }
async function readLedger(filePath: string) { try { return JSON.parse(await fs.readFile(filePath, "utf8")) as Ledger; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
async function writeJson(filePath: string, value: unknown) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function loadLocalEnv() { try { const text = fsSync.readFileSync(path.resolve(".env.local"), "utf8"); for (const line of text.split(/\r?\n/)) { const match = line.match(/^([A-Z0-9_]+)=(.*)$/); if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }

main().catch((error) => { console.error(error); process.exit(1); });
