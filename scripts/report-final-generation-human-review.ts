import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parseCsv, type ReviewCsvRow } from "../src/lib/evaluation/generation-review";

const answerableScores = ["groundedness_0_4", "key_fact_coverage_0_4", "citation_correctness_0_4", "citation_completeness_0_4", "directness_0_2"] as const;
const binaryScores = ["critical_unsupported_claim_0_1", "contradicts_evidence_0_1", "invalid_citation_label_0_1", "generator_failure_0_1"] as const;

async function main() {
  const input = path.resolve(arg("--input", "docs/evaluation/generation-final-test-human-review-v1.completed.csv"));
  const output = path.resolve(arg("--output", "docs/experiment-results/generation-final-test-human-review-v1-summary"));
  const inputText = await fs.readFile(input, "utf8");
  const { rows } = parseCsv(inputText);
  validate(rows);
  const protocol = JSON.parse(await fs.readFile("docs/experiments/generation-final-test.v1.json", "utf8")) as any;
  const generation = JSON.parse(await fs.readFile("docs/experiment-results/generation-final-test-v1.json", "utf8")) as any;
  const answerable = rows.filter((row) => row.answerability === "answerable");
  const unanswerable = rows.filter((row) => row.answerability === "unanswerable");
  const metrics = {
    meanNormalizedQuality: mean(answerable.map((row) => (num(row, "groundedness_0_4") + num(row, "key_fact_coverage_0_4") + num(row, "citation_correctness_0_4") + num(row, "citation_completeness_0_4")) / 16)),
    meanGroundedness: mean(answerable.map((row) => num(row, "groundedness_0_4"))),
    meanKeyFactCoverage: mean(answerable.map((row) => num(row, "key_fact_coverage_0_4"))),
    meanCitationCorrectness: mean(answerable.map((row) => num(row, "citation_correctness_0_4"))),
    meanCitationCompleteness: mean(answerable.map((row) => num(row, "citation_completeness_0_4"))),
    meanDirectness: mean(answerable.map((row) => num(row, "directness_0_2"))),
    correctAbstentionRate: mean(unanswerable.map((row) => num(row, "correct_abstention_0_1"))),
    criticalUnsupportedClaimRate: mean(rows.map((row) => num(row, "critical_unsupported_claim_0_1"))),
    contradictionRate: mean(rows.map((row) => num(row, "contradicts_evidence_0_1"))),
    invalidCitationLabelRate: mean(rows.map((row) => num(row, "invalid_citation_label_0_1"))),
    generatorFailureRate: mean(rows.map((row) => num(row, "generator_failure_0_1"))),
  };
  const limits = protocol.humanConfirmation;
  const checks = { normalizedQuality: metrics.meanNormalizedQuality >= limits.primaryMinimum, criticalUnsupportedClaim: metrics.criticalUnsupportedClaimRate <= limits.guardrails.criticalUnsupportedClaimRateMaximum, citationCorrectness: metrics.meanCitationCorrectness >= limits.guardrails.meanCitationCorrectnessMinimum, correctAbstention: metrics.correctAbstentionRate >= limits.guardrails.correctAbstentionRateMinimum, generatorFailure: metrics.generatorFailureRate <= limits.guardrails.generatorFailureRateMaximum };
  const artifact = { schemaVersion: 1, id: "generation-final-test-human-review-v1-summary", createdAt: new Date().toISOString(), split: "test", source: { humanReview: path.relative(process.cwd(), input).replaceAll("\\", "/"), humanReviewSha256: sha256(inputText), generationResult: "docs/experiment-results/generation-final-test-v1.json" }, review: { rows: rows.length, answerableRows: answerable.length, unanswerableRows: unanswerable.length, reviewers: [...new Set(rows.map((row) => row.reviewer_id))], status: "complete-single-reviewer-reference" }, metrics, checks, allPassed: generation.automatic.allPassed && Object.values(checks).every(Boolean), operationalChecksPassed: generation.automatic.allPassed, limitations: ["One thesis-author reviewer; inter-rater reliability is not estimated.", "The benchmark approvals remain pending-confirmation and AI-assisted.", "The human review confirms only the frozen GLM output and cannot be used to tune or regenerate it."] };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(`${output}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${output}.md`, render(artifact));
  console.log(`VALID ${artifact.id}: ${rows.length} rows; final confirmation=${artifact.allPassed ? "PASS" : "FAIL"}.`);
}

function validate(rows: ReviewCsvRow[]) {
  const errors: string[] = [];
  if (rows.length !== 24) errors.push(`Expected 24 rows, received ${rows.length}.`);
  if (new Set(rows.map((row) => row.case_id)).size !== 24) errors.push("Every locked case must occur exactly once.");
  if (rows.filter((row) => row.answerability === "answerable").length !== 12 || rows.filter((row) => row.answerability === "unanswerable").length !== 12) errors.push("Expected 12 answerable and 12 unanswerable rows.");
  for (const row of rows) {
    if (row.review_status !== "human-reviewed" || !row.reviewer_id || !row.reviewed_at) errors.push(`${row.case_id}: missing review provenance.`);
    for (const column of binaryScores) range(row, column, 0, 1, errors);
    if (row.answerability === "answerable") { for (const column of answerableScores) range(row, column, 0, column === "directness_0_2" ? 2 : 4, errors); if (row.correct_abstention_0_1 !== "") errors.push(`${row.case_id}: answerable abstention score must be blank.`); }
    else { range(row, "correct_abstention_0_1", 0, 1, errors); for (const column of answerableScores) if (row[column] !== "") errors.push(`${row.case_id}: ${column} must be blank.`); }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

function render(a: any) { return `# Final generation human review\n\n- Split: **test**\n- Rows: **${a.review.rows}** (${a.review.answerableRows} answerable, ${a.review.unanswerableRows} unanswerable)\n- Reviewer: **${a.review.reviewers.join(", ")}**\n- Automatic checks: **${a.operationalChecksPassed ? "PASS" : "FAIL"}**\n- Human quality confirmation: **${a.allPassed ? "PASS" : "FAIL"}**\n\n| Metric | Result |\n|---|---:|\n| Normalized grounded quality | ${a.metrics.meanNormalizedQuality.toFixed(4)} |\n| Groundedness | ${a.metrics.meanGroundedness.toFixed(3)} |\n| Key-fact coverage | ${a.metrics.meanKeyFactCoverage.toFixed(3)} |\n| Citation correctness | ${a.metrics.meanCitationCorrectness.toFixed(3)} |\n| Citation completeness | ${a.metrics.meanCitationCompleteness.toFixed(3)} |\n| Correct abstention | ${a.metrics.correctAbstentionRate.toFixed(3)} |\n| Critical unsupported-claim rate | ${a.metrics.criticalUnsupportedClaimRate.toFixed(4)} |\n| Generator-failure rate | ${a.metrics.generatorFailureRate.toFixed(4)} |\n\n${a.limitations.map((item: string) => `- ${item}`).join("\n")}\n`; }
function range(row: ReviewCsvRow, column: string, min: number, max: number, errors: string[]) { const value = Number(row[column]); if (row[column] === "" || !Number.isInteger(value) || value < min || value > max) errors.push(`${row.case_id}: ${column} must be ${min}-${max}.`); }
function num(row: ReviewCsvRow, column: string) { return Number(row[column]); }
function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function arg(name: string, fallback: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }

main().catch((error) => { console.error(error); process.exit(1); });
