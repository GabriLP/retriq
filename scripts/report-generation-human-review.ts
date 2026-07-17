import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv, type ReviewCsvRow } from "../src/lib/evaluation/generation-review";

type Rubric = {
  generatorSelection: {
    guardrails: {
      criticalUnsupportedClaimRateMaximum: number;
      meanCitationCorrectnessMinimum: number;
      correctAbstentionRateMinimum: number;
      generatorFailureRateMaximum: number;
    };
  };
};

type GenerationResult = {
  summaries: Array<{
    candidateId: string;
    blindVariantId: string;
    costUsd: number;
    latencyMs: { median: number; p95: number };
  }>;
};

const answerableScores = [
  "groundedness_0_4",
  "key_fact_coverage_0_4",
  "citation_correctness_0_4",
  "citation_completeness_0_4",
  "directness_0_2",
] as const;
const binaryScores = [
  "critical_unsupported_claim_0_1",
  "contradicts_evidence_0_1",
  "invalid_citation_label_0_1",
  "generator_failure_0_1",
] as const;

async function main() {
  const input = path.resolve(readArg("--input", "docs/evaluation/generation-human-review-v1.completed.csv"));
  const output = path.resolve(readArg("--output", "docs/experiment-results/generation-human-review-v1-summary"));
  const resultPath = path.resolve("docs/experiment-results/generation-model-comparison-v1-validation.json");
  const rubricPath = path.resolve("docs/evaluation/generation-human-rubric.v1.json");
  const inputText = await fs.readFile(input, "utf8");
  const { rows } = parseCsv(inputText);
  const result = JSON.parse(await fs.readFile(resultPath, "utf8")) as GenerationResult;
  const rubric = JSON.parse(await fs.readFile(rubricPath, "utf8")) as Rubric;
  validate(rows, result);

  const summaries = result.summaries.map((candidate) => summarize(rows, candidate, rubric));
  const eligible = summaries.filter((item) => item.guardrails.allPassed);
  const selected = [...eligible].sort((left, right) =>
    right.meanNormalizedQuality - left.meanNormalizedQuality
    || left.operational.costUsd - right.operational.costUsd
    || left.operational.medianLatencyMs - right.operational.medianLatencyMs,
  )[0];
  if (!selected) throw new Error("No generator satisfies every preregistered guardrail.");

  const artifact = {
    schemaVersion: 1,
    id: "generation-human-review-v1-summary",
    createdAt: new Date().toISOString(),
    split: "validation",
    testSplitTouched: false,
    source: {
      humanReview: path.relative(process.cwd(), input).replaceAll("\\", "/"),
      humanReviewSha256: sha256(inputText),
      rubric: "docs/evaluation/generation-human-rubric.v1.json",
      generatorOutputs: "docs/experiment-results/generation-model-comparison-v1-validation.json",
    },
    review: {
      rows: rows.length,
      answerableRows: rows.filter((row) => row.answerability === "answerable").length,
      unanswerableRows: rows.filter((row) => row.answerability === "unanswerable").length,
      reviewers: [...new Set(rows.map((row) => row.reviewer_id))],
      status: "complete-single-reviewer-reference",
    },
    summaries,
    selection: {
      candidateId: selected.candidateId,
      blindVariantId: selected.blindVariantId,
      rule: "Highest mean normalized grounded answer quality among candidates passing every preregistered guardrail; cost and median latency break ties.",
      testConfirmationPending: true,
    },
    limitations: [
      "The reference labels were produced by one human reviewer and therefore do not estimate inter-rater reliability.",
      "The review was completed quickly; a second reviewer should audit judge disagreements and a random sample of agreements.",
      "These validation labels may calibrate judge prompts but must not be reused as hidden test evidence.",
    ],
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(`${output}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${output}.md`, renderMarkdown(artifact));
  console.log(`VALID ${artifact.id}: ${rows.length} reviewed rows from ${artifact.review.reviewers.join(", ")}.`);
  console.log(`Selected on validation: ${selected.candidateId} (${selected.meanNormalizedQuality.toFixed(4)}).`);
  console.log(`Wrote ${output}.json and ${output}.md`);
}

function validate(rows: ReviewCsvRow[], result: GenerationResult) {
  const errors: string[] = [];
  if (rows.length !== 72) errors.push(`Expected 72 rows, received ${rows.length}.`);
  const expectedVariants = new Set(result.summaries.map((item) => item.blindVariantId));
  const rowKeys = new Set<string>();
  for (const row of rows) {
    const key = `${row.case_id}::${row.blind_variant_id}`;
    if (rowKeys.has(key)) errors.push(`Duplicate row ${key}.`);
    rowKeys.add(key);
    if (!expectedVariants.has(row.blind_variant_id)) errors.push(`Unknown blind variant ${row.blind_variant_id}.`);
    if (row.review_status !== "human-reviewed" || !row.reviewer_id || !row.reviewed_at) errors.push(`${key}: incomplete reviewer provenance.`);
    for (const column of binaryScores) validateNumber(row, column, 0, 1, errors);
    if (row.answerability === "answerable") {
      for (const column of answerableScores) validateNumber(row, column, 0, column === "directness_0_2" ? 2 : 4, errors);
      if (row.correct_abstention_0_1 !== "") errors.push(`${key}: abstention score must be blank for answerable cases.`);
    } else if (row.answerability === "unanswerable") {
      validateNumber(row, "correct_abstention_0_1", 0, 1, errors);
      for (const column of answerableScores) if (row[column] !== "") errors.push(`${key}: ${column} must be blank for unanswerable cases.`);
    } else errors.push(`${key}: invalid answerability '${row.answerability}'.`);
  }
  for (const variant of expectedVariants) {
    const variantRows = rows.filter((row) => row.blind_variant_id === variant);
    if (variantRows.length !== 24) errors.push(`${variant}: expected 24 rows, received ${variantRows.length}.`);
    if (variantRows.filter((row) => row.answerability === "answerable").length !== 12) errors.push(`${variant}: expected 12 answerable rows.`);
    if (variantRows.filter((row) => row.answerability === "unanswerable").length !== 12) errors.push(`${variant}: expected 12 unanswerable rows.`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

function summarize(rows: ReviewCsvRow[], candidate: GenerationResult["summaries"][number], rubric: Rubric) {
  const selected = rows.filter((row) => row.blind_variant_id === candidate.blindVariantId);
  const answerable = selected.filter((row) => row.answerability === "answerable");
  const unanswerable = selected.filter((row) => row.answerability === "unanswerable");
  const meanNormalizedQuality = mean(answerable.map((row) =>
    (numeric(row, "groundedness_0_4") + numeric(row, "key_fact_coverage_0_4")
      + numeric(row, "citation_correctness_0_4") + numeric(row, "citation_completeness_0_4")) / 16,
  ));
  const metrics = {
    meanGroundedness: mean(answerable.map((row) => numeric(row, "groundedness_0_4"))),
    meanKeyFactCoverage: mean(answerable.map((row) => numeric(row, "key_fact_coverage_0_4"))),
    meanCitationCorrectness: mean(answerable.map((row) => numeric(row, "citation_correctness_0_4"))),
    meanCitationCompleteness: mean(answerable.map((row) => numeric(row, "citation_completeness_0_4"))),
    meanDirectness: mean(answerable.map((row) => numeric(row, "directness_0_2"))),
    correctAbstentionRate: mean(unanswerable.map((row) => numeric(row, "correct_abstention_0_1"))),
    criticalUnsupportedClaimRate: mean(selected.map((row) => numeric(row, "critical_unsupported_claim_0_1"))),
    contradictionRate: mean(selected.map((row) => numeric(row, "contradicts_evidence_0_1"))),
    invalidCitationLabelRate: mean(selected.map((row) => numeric(row, "invalid_citation_label_0_1"))),
    generatorFailureRate: mean(selected.map((row) => numeric(row, "generator_failure_0_1"))),
  };
  const limits = rubric.generatorSelection.guardrails;
  const checks = {
    criticalUnsupportedClaim: metrics.criticalUnsupportedClaimRate <= limits.criticalUnsupportedClaimRateMaximum,
    citationCorrectness: metrics.meanCitationCorrectness >= limits.meanCitationCorrectnessMinimum,
    correctAbstention: metrics.correctAbstentionRate >= limits.correctAbstentionRateMinimum,
    generatorFailure: metrics.generatorFailureRate <= limits.generatorFailureRateMaximum,
  };
  return {
    candidateId: candidate.candidateId,
    blindVariantId: candidate.blindVariantId,
    answerableRows: answerable.length,
    unanswerableRows: unanswerable.length,
    meanNormalizedQuality,
    metrics,
    guardrails: { checks, allPassed: Object.values(checks).every(Boolean) },
    operational: { costUsd: candidate.costUsd, medianLatencyMs: candidate.latencyMs.median, p95LatencyMs: candidate.latencyMs.p95 },
  };
}

function renderMarkdown(artifact: {
  id: string;
  split: string;
  testSplitTouched: boolean;
  source: { humanReviewSha256: string };
  review: { rows: number; answerableRows: number; unanswerableRows: number; reviewers: string[]; status: string };
  summaries: ReturnType<typeof summarize>[];
  selection: { candidateId: string; rule: string; testConfirmationPending: boolean };
  limitations: string[];
}) {
  return `# Human generation review v1\n\n- Split: **${artifact.split}**\n- Human-reference rows: **${artifact.review.rows}** (${artifact.review.answerableRows} answerable, ${artifact.review.unanswerableRows} unanswerable)\n- Reviewer: **${artifact.review.reviewers.join(", ")}**\n- Review status: **${artifact.review.status}**\n- Source SHA-256: \`${artifact.source.humanReviewSha256}\`\n- Locked test split touched: **${artifact.testSplitTouched ? "yes" : "no"}**\n\n| Generator | Quality (0-1) | Grounded | Coverage | Citation correctness | Citation completeness | Directness | Abstention | Failure rate | All guardrails | Cost USD | Median ms |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|\n${artifact.summaries.map((item) => `| ${item.candidateId} | ${item.meanNormalizedQuality.toFixed(4)} | ${item.metrics.meanGroundedness.toFixed(3)} | ${item.metrics.meanKeyFactCoverage.toFixed(3)} | ${item.metrics.meanCitationCorrectness.toFixed(3)} | ${item.metrics.meanCitationCompleteness.toFixed(3)} | ${item.metrics.meanDirectness.toFixed(3)} | ${item.metrics.correctAbstentionRate.toFixed(3)} | ${(item.metrics.generatorFailureRate * 100).toFixed(2)}% | ${item.guardrails.allPassed ? "pass" : "fail"} | ${item.operational.costUsd.toFixed(6)} | ${item.operational.medianLatencyMs.toFixed(2)} |`).join("\n")}\n\n## Validation decision\n\n**${artifact.selection.candidateId}** is selected under the preregistered validation rule: ${artifact.selection.rule} The selection still requires one final confirmation on the untouched test split after judge calibration is frozen.\n\nGemini's single generator failure produces a 4.17% failure rate over its 24 reviewed rows, above the preregistered 2% maximum. Operational generation errors were zero; this flag is a human quality assessment of the produced answer.\n\n## Limitations\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

function mean(values: number[]) { return values.reduce((total, value) => total + value, 0) / values.length; }
function numeric(row: ReviewCsvRow, column: string) { return Number(row[column]); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readArg(name: string, fallback: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
function validateNumber(row: ReviewCsvRow, column: string, minimum: number, maximum: number, errors: string[]) {
  const value = Number(row[column]);
  if (row[column] === "" || !Number.isInteger(value) || value < minimum || value > maximum) errors.push(`${row.case_id}::${row.blind_variant_id}: ${column} must be an integer from ${minimum} to ${maximum}.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
