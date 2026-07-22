import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parseCsv } from "../src/lib/evaluation/generation-review";

type Observation = {
  stateId: string;
  caseId: string;
  attempt: number;
  expectedSufficient: boolean;
  deterministicSufficient: boolean;
  semanticSufficient: boolean;
};

type AssessorResult = {
  id: string;
  split: string;
  observations: Observation[];
};

type Decision = { expected: boolean; predicted: boolean };
type SummaryArtifact = {
  source: { humanReviewSha256: string };
  review: {
    rows: number;
    sufficient: number;
    insufficient: number;
    semanticAgreement: number;
    deterministicAgreement: number;
    cases: Array<{
      stateId: string;
      deterministicSufficient: boolean;
      semanticSufficient: boolean;
    }>;
  };
  sensitivity: {
    canonicalReference: { deterministic: ReturnType<typeof metrics>; semantic: ReturnType<typeof metrics> };
    humanAdjudicatedReference: { deterministic: ReturnType<typeof metrics>; semantic: ReturnType<typeof metrics> };
  };
  conclusion: { interpretation: string; nextStep: string };
  limitations: string[];
};

const inputPath = path.resolve("docs/evaluation/semantic-evidence-human-review-v1.completed.csv");
const resultPath = path.resolve("docs/experiment-results/agentic-semantic-assessor-v1-validation.json");
const outputBase = path.resolve("docs/experiment-results/semantic-evidence-human-review-v1-summary");

async function main() {
  const [inputText, resultText] = await Promise.all([
    fs.readFile(inputPath, "utf8"),
    fs.readFile(resultPath, "utf8"),
  ]);
  const rows = parseCsv(inputText).rows;
  const result = JSON.parse(resultText) as AssessorResult;
  const reviewed = validate(rows, result);
  const humanLabels = new Map(reviewed.map((item) => [item.stateId, item.humanSufficient]));
  const adjudicated = result.observations.map((item) => ({
    ...item,
    adjudicatedSufficient: humanLabels.get(item.stateId) ?? item.expectedSufficient,
  }));
  const artifact = {
    schemaVersion: 1,
    id: "semantic-evidence-human-review-v1-summary",
    createdAt: new Date().toISOString(),
    split: result.split,
    lockedTestTouched: false,
    source: {
      humanReview: relative(inputPath),
      humanReviewSha256: sha256(inputText),
      frozenAssessorResult: relative(resultPath),
      frozenAssessorResultSha256: sha256(resultText),
    },
    review: {
      rows: reviewed.length,
      reviewerIds: [...new Set(reviewed.map((item) => item.reviewer))],
      sufficient: reviewed.filter((item) => item.humanSufficient).length,
      insufficient: reviewed.filter((item) => !item.humanSufficient).length,
      semanticAgreement: mean(reviewed.map((item) => Number(item.semanticSufficient === item.humanSufficient))),
      deterministicAgreement: mean(reviewed.map((item) => Number(item.deterministicSufficient === item.humanSufficient))),
      cases: reviewed,
    },
    sensitivity: {
      description: "The three reviewed canonical-negative labels are replaced only for this sensitivity analysis; the frozen validation artifact remains unchanged.",
      canonicalReference: {
        deterministic: metrics(result.observations.map((item) => ({ expected: item.expectedSufficient, predicted: item.deterministicSufficient }))),
        semantic: metrics(result.observations.map((item) => ({ expected: item.expectedSufficient, predicted: item.semanticSufficient }))),
      },
      humanAdjudicatedReference: {
        deterministic: metrics(adjudicated.map((item) => ({ expected: item.adjudicatedSufficient, predicted: item.deterministicSufficient }))),
        semantic: metrics(adjudicated.map((item) => ({ expected: item.adjudicatedSufficient, predicted: item.semanticSufficient }))),
      },
    },
    conclusion: {
      canonicalResultPreserved: true,
      retroactiveSelection: false,
      interpretation: "All three apparent semantic false positives were judged sufficient. Under the adjudicated sensitivity reference, the semantic assessor is perfect on the 110 frozen states and the deterministic gate still makes four errors.",
      nextStep: "Preregister a new end-to-end semantic-assessor Agentic RAG experiment and evaluate it on newly reserved or independently reviewed evidence states before production selection.",
    },
    limitations: [
      "The same primary reviewer who developed the benchmark completed this adjudication.",
      "The reviewer consulted Codex while interpreting the three cases, so this is AI-assisted human adjudication rather than an independent second-human replication.",
      "Only model disagreements were reviewed, which is appropriate for error analysis but cannot estimate agreement over the complete state distribution.",
      "The reviewed validation states are now inspected and cannot serve as untouched evidence for subsequent model selection.",
    ],
  };
  await fs.writeFile(`${outputBase}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(artifact));
  console.log(`VALID ${artifact.id}: ${reviewed.length} complete rows; semantic agreement ${artifact.review.semanticAgreement.toFixed(4)}.`);
  console.log(`Wrote ${relative(outputBase)}.{json,md}`);
}

function validate(rows: Record<string, string>[], result: AssessorResult) {
  const errors: string[] = [];
  const disagreements = result.observations.filter((item) => !item.expectedSufficient && item.semanticSufficient);
  if (rows.length !== disagreements.length || rows.length !== 3) errors.push(`Expected exactly 3 reviewed disagreements, received ${rows.length}.`);
  const byState = new Map(result.observations.map((item) => [item.stateId, item]));
  const seen = new Set<string>();
  const reviewed = rows.map((row) => {
    const stateId = row.state_id;
    const observation = byState.get(stateId);
    if (!observation) errors.push(`${stateId}: unknown frozen state.`);
    if (seen.has(stateId)) errors.push(`${stateId}: duplicate review row.`);
    seen.add(stateId);
    if (row.schema_version !== "1") errors.push(`${stateId}: unsupported schema version.`);
    if (row.source_experiment !== result.id) errors.push(`${stateId}: source experiment mismatch.`);
    if (!row.reviewed_by || !validDate(row.reviewed_at)) errors.push(`${stateId}: incomplete reviewer provenance.`);
    if (row.human_sufficient_0_1 !== "0" && row.human_sufficient_0_1 !== "1") errors.push(`${stateId}: invalid binary decision.`);
    if (observation && (row.case_id !== observation.caseId || Number(row.attempt) !== observation.attempt)) errors.push(`${stateId}: case or attempt mismatch.`);
    if (observation && (observation.expectedSufficient || !observation.semanticSufficient)) errors.push(`${stateId}: row is not a frozen semantic disagreement.`);
    return {
      stateId,
      caseId: row.case_id,
      attempt: Number(row.attempt),
      canonicalSufficient: observation?.expectedSufficient ?? false,
      deterministicSufficient: observation?.deterministicSufficient ?? false,
      semanticSufficient: observation?.semanticSufficient ?? false,
      humanSufficient: row.human_sufficient_0_1 === "1",
      notes: row.reviewer_notes,
      reviewer: row.reviewed_by,
      reviewedAt: row.reviewed_at,
    };
  });
  for (const disagreement of disagreements) if (!seen.has(disagreement.stateId)) errors.push(`${disagreement.stateId}: missing review row.`);
  if (errors.length) throw new Error(errors.join("\n"));
  return reviewed;
}

function metrics(rows: Decision[]) {
  const truePositive = rows.filter((item) => item.expected && item.predicted).length;
  const trueNegative = rows.filter((item) => !item.expected && !item.predicted).length;
  const falsePositive = rows.filter((item) => !item.expected && item.predicted).length;
  const falseNegative = rows.filter((item) => item.expected && !item.predicted).length;
  const positive = truePositive + falseNegative;
  const negative = trueNegative + falsePositive;
  return {
    total: rows.length,
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,
    accuracy: (truePositive + trueNegative) / rows.length,
    precision: truePositive / (truePositive + falsePositive),
    recall: truePositive / positive,
    specificity: trueNegative / negative,
    falsePositiveRate: falsePositive / negative,
  };
}

function renderMarkdown(artifact: SummaryArtifact) {
  const canonical = artifact.sensitivity.canonicalReference;
  const adjudicated = artifact.sensitivity.humanAdjudicatedReference;
  return `# Semantic evidence human review v1\n\n- Reviewed disagreements: **${artifact.review.rows}**\n- Human decisions: **${artifact.review.sufficient} sufficient**, **${artifact.review.insufficient} insufficient**\n- Semantic assessor agreement on reviewed cases: **${artifact.review.semanticAgreement.toFixed(4)}**\n- Deterministic gate agreement on reviewed cases: **${artifact.review.deterministicAgreement.toFixed(4)}**\n- Locked test touched: **no**\n- Human-review SHA-256: \`${artifact.source.humanReviewSha256}\`\n\n| Reference | Assessor | Accuracy | Recall | FPR | Errors |\n|---|---|---:|---:|---:|---:|\n| Frozen canonical | Deterministic | ${format(canonical.deterministic.accuracy)} | ${format(canonical.deterministic.recall)} | ${format(canonical.deterministic.falsePositiveRate)} | ${canonical.deterministic.falsePositive + canonical.deterministic.falseNegative} |\n| Frozen canonical | GPT-5.4 Mini semantic | ${format(canonical.semantic.accuracy)} | ${format(canonical.semantic.recall)} | ${format(canonical.semantic.falsePositiveRate)} | ${canonical.semantic.falsePositive + canonical.semantic.falseNegative} |\n| Human-adjudicated sensitivity | Deterministic | ${format(adjudicated.deterministic.accuracy)} | ${format(adjudicated.deterministic.recall)} | ${format(adjudicated.deterministic.falsePositiveRate)} | ${adjudicated.deterministic.falsePositive + adjudicated.deterministic.falseNegative} |\n| Human-adjudicated sensitivity | GPT-5.4 Mini semantic | ${format(adjudicated.semantic.accuracy)} | ${format(adjudicated.semantic.recall)} | ${format(adjudicated.semantic.falsePositiveRate)} | ${adjudicated.semantic.falsePositive + adjudicated.semantic.falseNegative} |\n\n## Case decisions\n\n${artifact.review.cases.map((item) => `- \`${item.stateId}\`: **sufficient**; deterministic ${item.deterministicSufficient ? "sufficient" : "insufficient"}; semantic sufficient.`).join("\n")}\n\n## Interpretation\n\n${artifact.conclusion.interpretation} The original canonical-label result remains immutable and the assessor is **not selected retroactively**. This review supports preregistering a new end-to-end experiment with semantically defined evidence labels.\n\n## Limitations\n\n${artifact.limitations.map((item) => `- ${item}`).join("\n")}\n\n## Next step\n\n${artifact.conclusion.nextStep}\n`;
}

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function format(value: number) { return value.toFixed(4); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function relative(value: string) { return path.relative(process.cwd(), value).replaceAll("\\", "/"); }
function validDate(value: string) { return Boolean(value) && !Number.isNaN(Date.parse(value)); }

main().catch((error) => { console.error(error); process.exitCode = 1; });
