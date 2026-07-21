import type { ReviewValues, ScoreColumn } from "./generation-review";
import type { JudgeLabel } from "./judge-metrics";

export type AdjudicationDecision = "confirm-independent" | "revise-human" | "revise-judge" | "evidence-ambiguous";

export type JudgeAdjudicationTask = {
  id: string;
  caseId: string;
  blindVariantId: string;
  answerability: "answerable" | "unanswerable";
  language: string;
  question: string;
  expectedKeyFacts: string[];
  frozenEvidence: string;
  candidateAnswer: string;
  originalHuman: JudgeLabel;
  judge: JudgeLabel;
  judgeRationale: string;
  originalHumanNotes: string;
};

export type AdjudicationEntry = ReviewValues & {
  decision?: AdjudicationDecision;
  adjudication_notes?: string;
};

export type FrozenPhaseOne = {
  frozenAt: string;
  reviews: Record<string, ReviewValues>;
};

const flags: ScoreColumn[] = ["critical_unsupported_claim_0_1", "contradicts_evidence_0_1", "invalid_citation_label_0_1", "generator_failure_0_1"];
const answerableScores: ScoreColumn[] = ["groundedness_0_4", "key_fact_coverage_0_4", "citation_correctness_0_4", "citation_completeness_0_4", "directness_0_2"];

export function defaultAdjudication(): AdjudicationEntry {
  return { critical_unsupported_claim_0_1: 0, contradicts_evidence_0_1: 0, invalid_citation_label_0_1: 0, generator_failure_0_1: 0 };
}

export function isPhaseOneComplete(task: JudgeAdjudicationTask, review?: AdjudicationEntry) {
  if (!review) return false;
  const required = task.answerability === "answerable" ? [...answerableScores, ...flags] : ["correct_abstention_0_1" as ScoreColumn, ...flags];
  return required.every((column) => Number.isFinite(review[column]));
}

export function isAdjudicationComplete(task: JudgeAdjudicationTask, review?: AdjudicationEntry) {
  return isPhaseOneComplete(task, review) && Boolean(review?.decision);
}

export function labelFromHumanRow(row: Record<string, string>): JudgeLabel {
  const value = (column: string) => row[column] === "" ? null : Number(row[column]);
  return {
    answerability: row.answerability as JudgeLabel["answerability"],
    groundedness: value("groundedness_0_4"), keyFactCoverage: value("key_fact_coverage_0_4"),
    citationCorrectness: value("citation_correctness_0_4"), citationCompleteness: value("citation_completeness_0_4"),
    directness: value("directness_0_2"), correctAbstention: value("correct_abstention_0_1"),
    criticalUnsupportedClaim: Number(row.critical_unsupported_claim_0_1), contradictsEvidence: Number(row.contradicts_evidence_0_1),
    invalidCitationLabel: Number(row.invalid_citation_label_0_1), generatorFailure: Number(row.generator_failure_0_1)
  };
}

export function labelFromAuditRow(row: Record<string, string>): JudgeLabel {
  const scoreParts = Object.fromEntries(row.judge_scores.split("/").map((part) => [part.match(/^[A-Z]+/)?.[0], Number(part.match(/\d+$/)?.[0])]));
  const flagParts = Object.fromEntries(row.judge_flags.split("/").map((part) => [part[0], Number(part.slice(1))]));
  const answerable = row.answerability === "answerable";
  return {
    answerability: answerable ? "answerable" : "unanswerable",
    groundedness: answerable ? scoreParts.G : null,
    keyFactCoverage: answerable ? scoreParts.K : null,
    citationCorrectness: answerable ? scoreParts.CC : null,
    citationCompleteness: answerable ? scoreParts.CP : null,
    directness: answerable ? scoreParts.D : null,
    correctAbstention: answerable ? null : scoreParts.A,
    criticalUnsupportedClaim: flagParts.U, contradictsEvidence: flagParts.C,
    invalidCitationLabel: flagParts.I, generatorFailure: flagParts.F
  };
}

export function exportAdjudicationCsv(options: {
  tasks: JudgeAdjudicationTask[];
  phaseOne: FrozenPhaseOne;
  reviews: Record<string, AdjudicationEntry>;
  reviewerId: string;
  exportedAt: string;
}) {
  const headers = [
    "row_id", "case_id", "blind_variant_id", "answerability", "language", "question",
    ...answerableScores.map((column) => `phase1_${column}`), "phase1_correct_abstention_0_1", ...flags.map((column) => `phase1_${column}`),
    ...answerableScores.map((column) => `final_${column}`), "final_correct_abstention_0_1", ...flags.map((column) => `final_${column}`),
    "adjudication_decision", "adjudication_notes", "original_human_scores", "judge_scores", "judge_rationale",
    "phase1_frozen_at", "reviewer_id", "exported_at", "review_status"
  ];
  const rows = options.tasks.map((task) => {
    const phaseOne = options.phaseOne.reviews[task.id] ?? {};
    const final = options.reviews[task.id] ?? {};
    const record: Record<string, unknown> = {
      row_id: task.id, case_id: task.caseId, blind_variant_id: task.blindVariantId,
      answerability: task.answerability, language: task.language, question: task.question,
      adjudication_decision: final.decision ?? "", adjudication_notes: final.adjudication_notes ?? "",
      original_human_scores: compactLabel(task.originalHuman), judge_scores: compactLabel(task.judge), judge_rationale: task.judgeRationale,
      phase1_frozen_at: options.phaseOne.frozenAt, reviewer_id: options.reviewerId,
      exported_at: options.exportedAt, review_status: isAdjudicationComplete(task, final) ? "adjudicated" : "incomplete"
    };
    for (const column of [...answerableScores, "correct_abstention_0_1" as ScoreColumn, ...flags]) {
      record[`phase1_${column}`] = phaseOne[column] ?? "";
      record[`final_${column}`] = final[column] ?? "";
    }
    return headers.map((header) => record[header] ?? "");
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function compactLabel(label: JudgeLabel) {
  const scores = label.answerability === "answerable"
    ? `G${label.groundedness}/K${label.keyFactCoverage}/CC${label.citationCorrectness}/CP${label.citationCompleteness}/D${label.directness}`
    : `A${label.correctAbstention}`;
  return `${scores};U${label.criticalUnsupportedClaim}/C${label.contradictsEvidence}/I${label.invalidCitationLabel}/F${label.generatorFailure}`;
}

function csvCell(value: unknown) {
  const text = String(value).replace(/[ \t]+$/gm, "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
