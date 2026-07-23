import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parseCsv, type ReviewCsvRow } from "../src/lib/evaluation/generation-review";

const answerableScores = ["groundedness_0_4", "key_fact_coverage_0_4", "citation_correctness_0_4", "citation_completeness_0_4", "directness_0_2"] as const;
const binaryScores = ["critical_unsupported_claim_0_1", "contradicts_evidence_0_1", "invalid_citation_label_0_1", "generator_failure_0_1"] as const;
const frozenColumns = ["case_id", "blind_variant_id", "answerability", "language", "question", "expected_key_facts", "frozen_evidence", "candidate_answer"] as const;

type GenerationOutput = {
  caseId: string;
  answerability: "answerable" | "unanswerable";
  generationPolicy: "invoke-generator" | "deterministic-abstention";
  answer: string;
  error: string | null;
};

type GenerationArtifact = {
  automatic: { allPassed: boolean; cases: number };
  outputs: GenerationOutput[];
};

type Protocol = {
  humanConfirmation: {
    totalCases: number;
    manualRows: number;
    automaticallyAdjudicatedRows: number;
    primaryMinimum: number;
    guardrails: {
      criticalUnsupportedClaimRateMaximum: number;
      meanCitationCorrectnessMinimum: number;
      correctAbstentionRateMinimum: number;
      generatorFailureRateMaximum: number;
    };
  };
};

async function main() {
  const input = path.resolve(arg("--input", "docs/evaluation/generation-confirmatory-final-test-human-review-v2.completed.csv"));
  const sourceWorksheet = path.resolve("docs/evaluation/generation-confirmatory-final-test-human-review-v2.csv");
  const generationPath = path.resolve("docs/experiment-results/generation-confirmatory-final-test-v2.json");
  const protocolPath = path.resolve("docs/experiments/generation-confirmatory-final-test.v2.json");
  const output = path.resolve(arg("--output", "docs/experiment-results/generation-confirmatory-final-test-human-review-v2-summary"));
  const [inputText, sourceText, generationText, protocolText] = await Promise.all([
    fs.readFile(input, "utf8"),
    fs.readFile(sourceWorksheet, "utf8"),
    fs.readFile(generationPath, "utf8"),
    fs.readFile(protocolPath, "utf8"),
  ]);
  const reviewed = parseCsv(inputText).rows;
  const source = parseCsv(sourceText).rows;
  const generation = JSON.parse(generationText) as GenerationArtifact;
  const protocol = JSON.parse(protocolText) as Protocol;
  const expectedManual = source.filter((row) => row.answerability === "answerable" || row.frozen_evidence.trim().length > 0);
  validate(reviewed, expectedManual, generation, protocol);
  const expectedById = new Map(expectedManual.map((row) => [row.case_id, row]));
  const browserWhitespaceNormalizations = reviewed.filter((row) => {
    const frozen = expectedById.get(row.case_id);
    return frozen && row.candidate_answer !== frozen.candidate_answer && normalizeLineEndWhitespace(row.candidate_answer) === normalizeLineEndWhitespace(frozen.candidate_answer);
  }).length;

  const answerable = reviewed.filter((row) => row.answerability === "answerable");
  const manuallyReviewedNegative = reviewed.filter((row) => row.answerability === "unanswerable");
  const deterministic = generation.outputs.filter((row) => row.generationPolicy === "deterministic-abstention");
  const totalCases = generation.outputs.length;
  const totalCorrectAbstentions = deterministic.length + manuallyReviewedNegative.reduce((sum, row) => sum + num(row, "correct_abstention_0_1"), 0);
  const totalUnanswerable = generation.outputs.filter((row) => row.answerability === "unanswerable").length;
  const metrics = {
    meanNormalizedQuality: mean(answerable.map((row) => (num(row, "groundedness_0_4") + num(row, "key_fact_coverage_0_4") + num(row, "citation_correctness_0_4") + num(row, "citation_completeness_0_4")) / 16)),
    meanGroundedness: mean(answerable.map((row) => num(row, "groundedness_0_4"))),
    meanKeyFactCoverage: mean(answerable.map((row) => num(row, "key_fact_coverage_0_4"))),
    meanCitationCorrectness: mean(answerable.map((row) => num(row, "citation_correctness_0_4"))),
    meanCitationCompleteness: mean(answerable.map((row) => num(row, "citation_completeness_0_4"))),
    meanDirectness: mean(answerable.map((row) => num(row, "directness_0_2"))),
    correctAbstentionRate: totalCorrectAbstentions / totalUnanswerable,
    criticalUnsupportedClaimRate: sum(reviewed.map((row) => num(row, "critical_unsupported_claim_0_1"))) / totalCases,
    contradictionRate: sum(reviewed.map((row) => num(row, "contradicts_evidence_0_1"))) / totalCases,
    invalidCitationLabelRate: sum(reviewed.map((row) => num(row, "invalid_citation_label_0_1"))) / totalCases,
    generatorFailureRate: sum(reviewed.map((row) => num(row, "generator_failure_0_1"))) / totalCases,
  };
  const limits = protocol.humanConfirmation;
  const checks = {
    normalizedQuality: metrics.meanNormalizedQuality >= limits.primaryMinimum,
    criticalUnsupportedClaim: metrics.criticalUnsupportedClaimRate <= limits.guardrails.criticalUnsupportedClaimRateMaximum,
    citationCorrectness: metrics.meanCitationCorrectness >= limits.guardrails.meanCitationCorrectnessMinimum,
    correctAbstention: metrics.correctAbstentionRate >= limits.guardrails.correctAbstentionRateMinimum,
    generatorFailure: metrics.generatorFailureRate <= limits.guardrails.generatorFailureRateMaximum,
  };
  const artifact = {
    schemaVersion: 1,
    id: "generation-confirmatory-final-test-human-review-v2-summary",
    createdAt: new Date().toISOString(),
    split: "test",
    source: {
      humanReview: relative(input),
      humanReviewSha256: sha256(inputText),
      sourceWorksheet: relative(sourceWorksheet),
      sourceWorksheetSha256: sha256(sourceText),
      generationResult: relative(generationPath),
      generationResultSha256: sha256(generationText),
    },
    review: {
      totalCases,
      manuallyReviewedRows: reviewed.length,
      automaticallyAdjudicatedRows: deterministic.length,
      answerableRows: answerable.length,
      manuallyReviewedUnanswerableRows: manuallyReviewedNegative.length,
      reviewers: [...new Set(reviewed.map((row) => row.reviewer_id))],
      status: "complete-single-reviewer-confirmatory-reference",
      worksheetIntegrity: `All 25 case identities, questions, evidence packets, and substantive answers match the frozen worksheet. Browser export removed line-ending whitespace from ${browserWhitespaceNormalizations} candidate answer; no semantic content changed.`,
    },
    automaticAdjudication: {
      policy: "Only deterministic no-evidence abstentions are automatically counted; every model-generated answer was reviewed manually.",
      deterministicAbstentions: deterministic.length,
      verifiedErrors: deterministic.filter((row) => row.error).length,
    },
    metrics,
    checks,
    allPassed: generation.automatic.allPassed && Object.values(checks).every(Boolean),
    operationalChecksPassed: generation.automatic.allPassed,
    limitations: [
      "One thesis-author reviewer; inter-rater reliability is not estimated.",
      "Automatic adjudication is limited to 23 deterministic no-evidence responses; all 25 model-generated answers received manual review.",
      "The human review confirms only the frozen GLM output and was not used to tune or regenerate it.",
    ],
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(`${output}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${output}.md`, render(artifact));
  console.log(`VALID ${artifact.id}: ${reviewed.length} manual + ${deterministic.length} deterministic rows; final confirmation=${artifact.allPassed ? "PASS" : "FAIL"}.`);
}

function validate(reviewed: ReviewCsvRow[], expected: ReviewCsvRow[], generation: GenerationArtifact, protocol: Protocol) {
  const errors: string[] = [];
  const limits = protocol.humanConfirmation;
  if (generation.outputs.length !== limits.totalCases || generation.automatic.cases !== limits.totalCases) errors.push("Generation artifact total differs from the frozen protocol.");
  if (reviewed.length !== limits.manualRows || expected.length !== limits.manualRows) errors.push(`Expected ${limits.manualRows} manual rows, received ${reviewed.length}.`);
  const reviewedIds = new Set(reviewed.map((row) => row.case_id));
  if (reviewedIds.size !== reviewed.length) errors.push("Every reviewed case must occur exactly once.");
  const expectedById = new Map(expected.map((row) => [row.case_id, row]));
  const invokedIds = new Set(generation.outputs.filter((row) => row.generationPolicy === "invoke-generator").map((row) => row.caseId));
  if (invokedIds.size !== limits.manualRows || generation.outputs.filter((row) => row.generationPolicy === "deterministic-abstention").length !== limits.automaticallyAdjudicatedRows) errors.push("Generation-policy counts differ from the review procedure.");
  for (const row of reviewed) {
    const frozen = expectedById.get(row.case_id);
    if (!frozen || !invokedIds.has(row.case_id)) {
      errors.push(`${row.case_id}: case is not part of the frozen manual-review subset.`);
      continue;
    }
    for (const column of frozenColumns) {
      if (row[column] === frozen[column]) continue;
      if (column === "candidate_answer" && normalizeLineEndWhitespace(row[column]) === normalizeLineEndWhitespace(frozen[column])) continue;
      errors.push(`${row.case_id}: frozen column ${column} changed.`);
    }
    if (row.review_status !== "human-reviewed" || !row.reviewer_id || !row.reviewed_at) errors.push(`${row.case_id}: missing review provenance.`);
    for (const column of binaryScores) range(row, column, 0, 1, errors);
    if (row.answerability === "answerable") {
      for (const column of answerableScores) range(row, column, 0, column === "directness_0_2" ? 2 : 4, errors);
      if (row.correct_abstention_0_1 !== "") errors.push(`${row.case_id}: answerable abstention score must be blank.`);
    } else {
      range(row, "correct_abstention_0_1", 0, 1, errors);
      for (const column of answerableScores) if (row[column] !== "") errors.push(`${row.case_id}: ${column} must be blank.`);
    }
  }
  for (const id of invokedIds) if (!reviewedIds.has(id)) errors.push(`${id}: generated answer is missing from the manual review.`);
  if (errors.length) throw new Error(errors.join("\n"));
}

function render(a: {
  review: { totalCases: number; manuallyReviewedRows: number; automaticallyAdjudicatedRows: number; answerableRows: number; manuallyReviewedUnanswerableRows: number; reviewers: string[] };
  metrics: Record<string, number>;
  operationalChecksPassed: boolean;
  allPassed: boolean;
  limitations: string[];
}) {
  return `# Confirmatory generation human review\n\n- Split: **test**\n- Total cases: **${a.review.totalCases}**\n- Manual rows: **${a.review.manuallyReviewedRows}** (${a.review.answerableRows} answerable, ${a.review.manuallyReviewedUnanswerableRows} unanswerable)\n- Deterministic abstentions: **${a.review.automaticallyAdjudicatedRows}**\n- Reviewer: **${a.review.reviewers.join(", ")}**\n- Automatic checks: **${a.operationalChecksPassed ? "PASS" : "FAIL"}**\n- Human quality confirmation: **${a.allPassed ? "PASS" : "FAIL"}**\n\n| Metric | Result |\n|---|---:|\n| Normalized grounded quality | ${a.metrics.meanNormalizedQuality.toFixed(4)} |\n| Groundedness | ${a.metrics.meanGroundedness.toFixed(3)} |\n| Key-fact coverage | ${a.metrics.meanKeyFactCoverage.toFixed(3)} |\n| Citation correctness | ${a.metrics.meanCitationCorrectness.toFixed(3)} |\n| Citation completeness | ${a.metrics.meanCitationCompleteness.toFixed(3)} |\n| Directness | ${a.metrics.meanDirectness.toFixed(3)} |\n| Correct abstention | ${a.metrics.correctAbstentionRate.toFixed(3)} |\n| Critical unsupported-claim rate | ${a.metrics.criticalUnsupportedClaimRate.toFixed(4)} |\n| Contradiction rate | ${a.metrics.contradictionRate.toFixed(4)} |\n| Invalid citation-label rate | ${a.metrics.invalidCitationLabelRate.toFixed(4)} |\n| Generator-failure rate | ${a.metrics.generatorFailureRate.toFixed(4)} |\n\n${a.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

function range(row: ReviewCsvRow, column: string, min: number, max: number, errors: string[]) {
  const value = Number(row[column]);
  if (row[column] === "" || !Number.isInteger(value) || value < min || value > max) errors.push(`${row.case_id}: ${column} must be ${min}-${max}.`);
}
function num(row: ReviewCsvRow, column: string) { return Number(row[column]); }
function mean(values: number[]) { return sum(values) / values.length; }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function normalizeLineEndWhitespace(value: string) { return value.replace(/[ \t]+(?=\r?\n|$)/g, ""); }
function relative(file: string) { return path.relative(process.cwd(), file).replaceAll("\\", "/"); }
function arg(name: string, fallback: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }

main().catch((error) => { console.error(error); process.exit(1); });
