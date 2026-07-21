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
  judge: {
    id: string; model: string; expectedResponseModel: string; expectedResponseProvider: string; providerOrder: string[];
    reasoningEffort: "low" | "medium" | "high"; maxCompletionTokens: number;
    inputPriceUsdPerMillionTokens: number; outputPriceUsdPerMillionTokens: number;
  };
  acceptanceCriteria: {
    minimumPooledCoreQuadraticWeightedKappa: number;
    minimumAnswerableQualitySpearman: number;
    minimumBinaryPassAgreement: number;
    requiredStructuredValidityRate: number;
    requiredAnswerabilityConsistencyRate: number;
    maximumProviderErrors: number;
  };
};
type SplitManifest = { sourceSha256: string; assignments: Array<{ rowId: string; split: "calibration" | "audit" }> };
type Evaluated = { row: ReviewCsvRow; rowId: string; split: "calibration" | "audit"; human: JudgeLabel; judge: JudgeLabel; result: JudgeResult };

const coreDimensions = ["groundedness", "keyFactCoverage", "citationCorrectness", "citationCompleteness"] as const;
const allDimensions = [...coreDimensions, "directness"] as const;
const flagDimensions = ["criticalUnsupportedClaim", "contradictsEvidence", "invalidCitationLabel", "generatorFailure"] as const;

async function main() {
  loadLocalEnv();
  const allowProviderRequests = process.argv.includes("--allow-provider-requests");
  const inputPath = path.resolve("docs/evaluation/generation-human-review-v1.completed.csv");
  const promptPath = path.resolve("docs/evaluation/llm-judge-prompt.v1.json");
  const protocolPath = path.resolve("docs/experiments/llm-judge-calibration.v1.1.json");
  const splitPath = path.resolve("docs/evaluation/llm-judge-split.v1.json");
  const outputBase = path.resolve("docs/experiment-results/llm-judge-calibration-v1.1-validation");
  const inputText = await fs.readFile(inputPath, "utf8");
  const { rows } = parseCsv(inputText);
  const prompt = JSON.parse(await fs.readFile(promptPath, "utf8")) as PromptArtifact;
  const protocol = JSON.parse(await fs.readFile(protocolPath, "utf8")) as Protocol;
  const split = JSON.parse(await fs.readFile(splitPath, "utf8")) as SplitManifest;
  if (sha256(inputText) !== split.sourceSha256) throw new Error("Human-reference CSV no longer matches the frozen split manifest.");
  const splitByRow = new Map(split.assignments.map((item) => [item.rowId, item.split]));
  validateRows(rows, splitByRow);

  const candidate: JudgeCandidate = {
    id: protocol.judge.id,
    model: protocol.judge.model,
    expectedResponseModel: protocol.judge.expectedResponseModel,
    expectedResponseProvider: protocol.judge.expectedResponseProvider,
    providerOrder: protocol.judge.providerOrder,
    reasoningEffort: protocol.judge.reasoningEffort,
    inputPriceUsdPerMillionTokens: protocol.judge.inputPriceUsdPerMillionTokens,
    outputPriceUsdPerMillionTokens: protocol.judge.outputPriceUsdPerMillionTokens,
  };
  const systemInstruction = `${prompt.systemInstruction}\n\nScore anchors:\n${JSON.stringify(prompt.scoreAnchors, null, 2)}`;
  const tasks = rows.map((row) => {
    const userPrompt = buildUserPrompt(row);
    const options = { candidate, systemInstruction, userPrompt, schema: buildJudgeResponseSchema(prompt.responseSchema, row.answerability as "answerable" | "unanswerable"), maxOutputTokens: protocol.judge.maxCompletionTokens };
    return { row, rowId: rowId(row), split: splitByRow.get(rowId(row))!, userPrompt, cacheKey: judgeCacheKey(options), options };
  });
  const uniqueTasks = [...new Map(tasks.map((task) => [task.cacheKey, task])).values()];
  console.log(`Judge evaluation: ${rows.length} rows, ${uniqueTasks.length} unique requests, provider requests ${allowProviderRequests ? "enabled" : "disabled"}.`);
  const resultByKey = new Map<string, JudgeResult>();
  let completed = 0;
  for (const task of uniqueTasks) {
    const result = await withRetries(() => judgeWithOpenRouter({ ...task.options, allowProviderRequests }), 3);
    resultByKey.set(task.cacheKey, result);
    completed += 1;
    console.log(`[${completed}/${uniqueTasks.length}] ${task.split} ${task.rowId} ${result.cacheHit ? "cache" : "provider"} $${result.usage.costUsd.toFixed(6)}`);
  }

  const evaluated: Evaluated[] = tasks.map((task) => {
    const result = resultByKey.get(task.cacheKey)!;
    if (result.output.answerability !== task.row.answerability) throw new Error(`${task.rowId}: judge answerability ${result.output.answerability} differs from task ${task.row.answerability}.`);
    return { row: task.row, rowId: task.rowId, split: task.split, human: humanLabel(task.row), judge: outputLabel(result.output), result };
  });
  const splitMetrics = Object.fromEntries((["calibration", "audit"] as const).map((name) => [name, summarize(evaluated.filter((item) => item.split === name), protocol)])) as Record<"calibration" | "audit", ReturnType<typeof summarize>>;
  const uniqueResults = [...resultByKey.values()];
  const checks = Object.fromEntries((["calibration", "audit"] as const).map((name) => [name, acceptance(splitMetrics[name], protocol)])) as Record<"calibration" | "audit", ReturnType<typeof acceptance>>;
  const auditRows = buildAuditRows(evaluated.filter((item) => item.split === "audit"));
  const artifact = {
    schemaVersion: 1,
    id: "llm-judge-calibration-v1.1-validation",
    createdAt: new Date().toISOString(),
    protocol: "docs/experiments/llm-judge-calibration.v1.json",
    protocolSha256: sha256(await fs.readFile(protocolPath, "utf8")),
    prompt: "docs/evaluation/llm-judge-prompt.v1.json",
    promptSha256: sha256(await fs.readFile(promptPath, "utf8")),
    humanReviewSha256: sha256(inputText),
    split: "validation-calibration-plus-held-out-audit",
    lockedGenerationTestTouched: false,
    judge: candidate,
    execution: {
      rows: evaluated.length,
      uniqueRequests: uniqueTasks.length,
      deduplicatedRows: evaluated.length - uniqueTasks.length,
      providerCallsThisRun: uniqueResults.filter((result) => !result.cacheHit).length,
      cacheHitsThisRun: uniqueResults.filter((result) => result.cacheHit).length,
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
    metrics: splitMetrics,
    acceptance: {
      calibration: checks.calibration,
      audit: checks.audit,
      allPassed: checks.calibration.allPassed && checks.audit.allPassed,
      decision: checks.calibration.allPassed && checks.audit.allPassed
        ? "Eligible to freeze after secondary human audit of disagreements."
        : "Not eligible. Any new prompt or model requires a separate preregistered attempt.",
    },
    secondaryHumanAudit: {
      file: "docs/experiment-results/llm-judge-calibration-v1.1-disagreement-audit.csv",
      disagreementRows: auditRows.filter((row) => row.needs_audit === "yes").length,
      sampledAgreementRows: auditRows.filter((row) => row.audit_reason === "deterministic-agreement-sample").length,
      completed: false,
    },
    limitations: [
      "The human reference has one reviewer and no inter-rater reliability estimate.",
      "The held-out audit is internal to validation and is not the locked generation test.",
      "Repeated deterministic abstentions share one provider judgment but remain separate generator-level agreement rows.",
    ],
  };
  await fs.writeFile(`${outputBase}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(artifact));
  await fs.writeFile(path.resolve("docs/experiment-results/llm-judge-calibration-v1.1-disagreement-audit.csv"), toCsv(auditRows));
  console.log(`Wrote ${path.relative(process.cwd(), outputBase)}.{json,md} and disagreement audit CSV.`);
  console.log(`Acceptance: ${artifact.acceptance.allPassed ? "PASS" : "FAIL"}. Cost: $${artifact.execution.observedCostUsd.toFixed(6)}.`);
}

function summarize(items: Evaluated[], protocol: Protocol) {
  const answerable = items.filter((item) => item.human.answerability === "answerable");
  const humanCore = answerable.flatMap((item) => coreDimensions.map((key) => item.human[key]!));
  const judgeCore = answerable.flatMap((item) => coreDimensions.map((key) => item.judge[key]!));
  const humanPass = items.map((item) => passesQuality(item.human));
  const judgePass = items.map((item) => passesQuality(item.judge));
  return {
    rows: items.length,
    answerableRows: answerable.length,
    unanswerableRows: items.length - answerable.length,
    primary: {
      pooledCoreQuadraticWeightedKappa: quadraticWeightedKappa(humanCore, judgeCore, 4),
      answerableQualitySpearman: spearmanCorrelation(answerable.map((item) => normalizedQuality(item.human)), answerable.map((item) => normalizedQuality(item.judge))),
      binaryPassAgreement: agreement(humanPass, judgePass),
    },
    dimensions: Object.fromEntries(allDimensions.map((key) => {
      const reference = answerable.map((item) => item.human[key]!);
      const predicted = answerable.map((item) => item.judge[key]!);
      const maximum = key === "directness" ? 2 : 4;
      return [key, {
        quadraticWeightedKappa: quadraticWeightedKappa(reference, predicted, maximum),
        meanAbsoluteError: meanAbsoluteError(reference, predicted),
        exactAgreement: mean(reference.map((value, index) => Number(value === predicted[index]))),
        withinOneAgreement: mean(reference.map((value, index) => Number(Math.abs(value - predicted[index]) <= 1))),
      }];
    })),
    correctAbstentionAgreement: agreement(
      items.filter((item) => item.human.answerability === "unanswerable").map((item) => item.human.correctAbstention === 1),
      items.filter((item) => item.human.answerability === "unanswerable").map((item) => item.judge.correctAbstention === 1),
    ),
    flags: Object.fromEntries(flagDimensions.map((key) => [key, {
      agreement: agreement(items.map((item) => item.human[key] === 1), items.map((item) => item.judge[key] === 1)),
      humanPositiveRate: mean(items.map((item) => item.human[key])),
      judgePositiveRate: mean(items.map((item) => item.judge[key])),
    }])),
    passConfusion: confusion(humanPass, judgePass),
    structuredValidityRate: 1,
    answerabilityConsistencyRate: 1,
    providerErrors: 0,
    thresholds: protocol.acceptanceCriteria,
  };
}

function acceptance(metrics: ReturnType<typeof summarize>, protocol: Protocol) {
  const thresholds = protocol.acceptanceCriteria;
  const checks = {
    pooledCoreQuadraticWeightedKappa: metrics.primary.pooledCoreQuadraticWeightedKappa >= thresholds.minimumPooledCoreQuadraticWeightedKappa,
    answerableQualitySpearman: metrics.primary.answerableQualitySpearman !== null && metrics.primary.answerableQualitySpearman >= thresholds.minimumAnswerableQualitySpearman,
    binaryPassAgreement: metrics.primary.binaryPassAgreement >= thresholds.minimumBinaryPassAgreement,
    structuredValidityRate: metrics.structuredValidityRate >= thresholds.requiredStructuredValidityRate,
    answerabilityConsistencyRate: metrics.answerabilityConsistencyRate >= thresholds.requiredAnswerabilityConsistencyRate,
    providerErrors: metrics.providerErrors <= thresholds.maximumProviderErrors,
  };
  return { checks, allPassed: Object.values(checks).every(Boolean) };
}

function buildAuditRows(items: Evaluated[]) {
  const rows = items.map((item) => {
    const scoreDelta = item.human.answerability === "answerable"
      ? Math.max(...allDimensions.map((key) => Math.abs(item.human[key]! - item.judge[key]!)))
      : Math.abs(item.human.correctAbstention! - item.judge.correctAbstention!);
    const flagMismatch = flagDimensions.some((key) => item.human[key] !== item.judge[key]);
    const passMismatch = passesQuality(item.human) !== passesQuality(item.judge);
    const reason = passMismatch ? "pass-mismatch" : flagMismatch ? "flag-mismatch" : scoreDelta >= 2 ? "score-delta-at-least-2" : "";
    return auditCsvRow(item, reason ? "yes" : "no", reason);
  });
  const agreements = rows.filter((row) => row.needs_audit === "no")
    .sort((left, right) => sha256(`audit-sample:${left.row_id}`).localeCompare(sha256(`audit-sample:${right.row_id}`)))
    .slice(0, 6);
  for (const row of agreements) { row.needs_audit = "yes"; row.audit_reason = "deterministic-agreement-sample"; }
  return rows.sort((left, right) => left.row_id.localeCompare(right.row_id));
}

function auditCsvRow(item: Evaluated, needsAudit: string, reason: string) {
  return {
    row_id: item.rowId, case_id: item.row.case_id, blind_variant_id: item.row.blind_variant_id,
    answerability: item.row.answerability, question: item.row.question,
    human_quality: normalizedQuality(item.human).toFixed(4), judge_quality: normalizedQuality(item.judge).toFixed(4),
    human_pass: String(passesQuality(item.human)), judge_pass: String(passesQuality(item.judge)),
    human_scores: compactScores(item.human), judge_scores: compactScores(item.judge),
    human_flags: compactFlags(item.human), judge_flags: compactFlags(item.judge),
    judge_rationale: item.result.output.rationale,
    needs_audit: needsAudit, audit_reason: reason,
    secondary_review_status: "pending", secondary_reviewer_notes: "",
  };
}

function buildUserPrompt(row: ReviewCsvRow) {
  return `Task type: ${row.answerability}\nLanguage: ${row.language}\n\nQuestion:\n${row.question}\n\nExpected key facts:\n${row.expected_key_facts || "(none; the benchmark expects abstention)"}\n\nFrozen evidence:\n${row.frozen_evidence || "(no evidence passed the retrieval acceptance gate)"}\n\nCandidate answer:\n${row.candidate_answer}`;
}

function humanLabel(row: ReviewCsvRow): JudgeLabel {
  const numberOrNull = (column: string) => row[column] === "" ? null : Number(row[column]);
  return {
    answerability: row.answerability as JudgeLabel["answerability"],
    groundedness: numberOrNull("groundedness_0_4"), keyFactCoverage: numberOrNull("key_fact_coverage_0_4"),
    citationCorrectness: numberOrNull("citation_correctness_0_4"), citationCompleteness: numberOrNull("citation_completeness_0_4"),
    directness: numberOrNull("directness_0_2"), correctAbstention: numberOrNull("correct_abstention_0_1"),
    criticalUnsupportedClaim: Number(row.critical_unsupported_claim_0_1), contradictsEvidence: Number(row.contradicts_evidence_0_1),
    invalidCitationLabel: Number(row.invalid_citation_label_0_1), generatorFailure: Number(row.generator_failure_0_1),
  };
}

function outputLabel(output: JudgeOutput): JudgeLabel {
  return {
    answerability: output.answerability, ...output.scores,
    criticalUnsupportedClaim: Number(output.flags.criticalUnsupportedClaim), contradictsEvidence: Number(output.flags.contradictsEvidence),
    invalidCitationLabel: Number(output.flags.invalidCitationLabel), generatorFailure: Number(output.flags.generatorFailure),
  };
}

function validateRows(rows: ReviewCsvRow[], splitByRow: Map<string, "calibration" | "audit">) {
  if (rows.length !== 72 || splitByRow.size !== 72) throw new Error("Expected 72 rows and split assignments.");
  for (const row of rows) {
    if (!splitByRow.has(rowId(row))) throw new Error(`Missing split for ${rowId(row)}.`);
    if (row.review_status !== "human-reviewed") throw new Error(`${rowId(row)} is not human reviewed.`);
    humanLabel(row);
  }
}

async function withRetries<T>(operation: () => Promise<T>, maximumAttempts: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (attempt === maximumAttempts || !isTransient(error)) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

function isTransient(error: unknown) { return /OpenRouter (408|409|429|5\d\d)|fetch failed|timeout/i.test(String(error)); }
function rowId(row: ReviewCsvRow) { return `${row.case_id}::${row.blind_variant_id}`; }
function compactScores(label: JudgeLabel) { return label.answerability === "answerable" ? `G${label.groundedness}/K${label.keyFactCoverage}/CC${label.citationCorrectness}/CP${label.citationCompleteness}/D${label.directness}` : `A${label.correctAbstention}`; }
function compactFlags(label: JudgeLabel) { return `U${label.criticalUnsupportedClaim}/C${label.contradictsEvidence}/I${label.invalidCitationLabel}/F${label.generatorFailure}`; }
function confusion(reference: boolean[], predicted: boolean[]) { return { truePositive: reference.filter((value, index) => value && predicted[index]).length, trueNegative: reference.filter((value, index) => !value && !predicted[index]).length, falsePositive: reference.filter((value, index) => !value && predicted[index]).length, falseNegative: reference.filter((value, index) => value && !predicted[index]).length }; }
function frequencies(values: string[]) { return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length])); }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function distribution(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return { mean: mean(values), median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }; }
function percentile(sorted: number[], ratio: number) { return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]; }
function sha256(value: string | Buffer) { return crypto.createHash("sha256").update(value).digest("hex"); }

function toCsv(rows: Array<Record<string, string>>) {
  const headers = Object.keys(rows[0]);
  const cell = (value: string) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header]))].map((record) => record.map(cell).join(",")).join("\n")}\n`;
}

function renderMarkdown(artifact: {
  judge: JudgeCandidate;
  execution: { responseProviders: string[]; rows: number; uniqueRequests: number; observedCostUsd: number };
  metrics: Record<"calibration" | "audit", ReturnType<typeof summarize>>;
  acceptance: Record<"calibration" | "audit", ReturnType<typeof acceptance>> & { allPassed: boolean; decision: string };
  secondaryHumanAudit: { disagreementRows: number; sampledAgreementRows: number };
  limitations: string[];
}) {
  const row = (name: "calibration" | "audit") => {
    const metrics = artifact.metrics[name];
    return `| ${name} | ${metrics.rows} | ${metrics.primary.pooledCoreQuadraticWeightedKappa.toFixed(4)} | ${metrics.primary.answerableQualitySpearman === null ? "n/a" : metrics.primary.answerableQualitySpearman.toFixed(4)} | ${metrics.primary.binaryPassAgreement.toFixed(4)} | ${artifact.acceptance[name].allPassed ? "pass" : "fail"} |`;
  };
  return `# LLM judge calibration v1.1\n\n- Judge: **${artifact.judge.model}** via **${artifact.execution.responseProviders.join(", ")}**, medium reasoning\n- Human-reference rows: **${artifact.execution.rows}**; unique provider inputs: **${artifact.execution.uniqueRequests}**\n- Locked generation test touched: **no**\n- Observed provider cost: **$${artifact.execution.observedCostUsd.toFixed(6)}**\n\n| Split | Rows | Pooled core QWK | Quality Spearman | Binary pass agreement | Guardrails |\n|---|---:|---:|---:|---:|---|\n${row("calibration")}\n${row("audit")}\n\n## Decision\n\n**${artifact.acceptance.allPassed ? "PASS" : "FAIL"}** — ${artifact.acceptance.decision}\n\nA secondary human audit remains pending for ${artifact.secondaryHumanAudit.disagreementRows} disagreements and ${artifact.secondaryHumanAudit.sampledAgreementRows} deterministically sampled agreements. The judge is not enabled in production.\n\n## Interpretation limits\n\n${artifact.limitations.map((item: string) => `- ${item}`).join("\n")}\n`;
}

function loadLocalEnv() {
  try {
    const text = fsSync.readFileSync(path.resolve(".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

main().catch((error) => { console.error(error); process.exit(1); });
