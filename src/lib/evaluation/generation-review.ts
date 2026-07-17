export const scoreColumns = [
  "groundedness_0_4",
  "key_fact_coverage_0_4",
  "citation_correctness_0_4",
  "citation_completeness_0_4",
  "directness_0_2",
  "correct_abstention_0_1",
  "critical_unsupported_claim_0_1",
  "contradicts_evidence_0_1",
  "invalid_citation_label_0_1",
  "generator_failure_0_1",
] as const;

export type ScoreColumn = (typeof scoreColumns)[number];
export type ReviewCsvRow = Record<string, string>;
export type ReviewValues = Partial<Record<ScoreColumn, number>> & { reviewer_notes?: string };

export type GenerationReviewTask = {
  id: string;
  sourceRowIds: string[];
  caseId: string;
  blindVariantId: string;
  answerability: "answerable" | "unanswerable";
  language: string;
  question: string;
  expectedKeyFacts: string[];
  frozenEvidence: string;
  candidateAnswer: string;
};

export function parseCsv(input: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { record.push(field); field = ""; }
    else if (character === "\n") { record.push(field.replace(/\r$/, "")); records.push(record); record = []; field = ""; }
    else field += character;
  }
  if (field.length || record.length) { record.push(field.replace(/\r$/, "")); records.push(record); }
  const headers = records.shift() ?? [];
  const rows = records.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  return { headers, rows };
}

export function buildReviewTasks(rows: ReviewCsvRow[]) {
  const tasks: GenerationReviewTask[] = [];
  const unanswerable = new Map<string, GenerationReviewTask>();
  for (const row of rows) {
    const rowId = rowIdFor(row);
    if (row.answerability === "unanswerable") {
      const existing = unanswerable.get(row.case_id);
      if (existing) {
        if (existing.candidateAnswer !== row.candidate_answer) throw new Error(`Unanswerable case ${row.case_id} has non-identical deterministic answers.`);
        existing.sourceRowIds.push(rowId);
        continue;
      }
      const task = toTask(row, `${row.case_id}::deterministic-abstention`, "deterministic");
      unanswerable.set(row.case_id, task);
      tasks.push(task);
      continue;
    }
    tasks.push(toTask(row, rowId, row.blind_variant_id));
  }
  return tasks.sort((left, right) => left.caseId.localeCompare(right.caseId) || left.blindVariantId.localeCompare(right.blindVariantId));
}

export function requiredScores(task: GenerationReviewTask): ScoreColumn[] {
  const flags: ScoreColumn[] = ["critical_unsupported_claim_0_1", "contradicts_evidence_0_1", "invalid_citation_label_0_1", "generator_failure_0_1"];
  return task.answerability === "answerable"
    ? ["groundedness_0_4", "key_fact_coverage_0_4", "citation_correctness_0_4", "citation_completeness_0_4", "directness_0_2", ...flags]
    : ["correct_abstention_0_1", ...flags];
}

export function isReviewComplete(task: GenerationReviewTask, review?: ReviewValues) {
  return Boolean(review && requiredScores(task).every((column) => Number.isFinite(review[column])));
}

export function exportReviewedCsv(options: { headers: string[]; rows: ReviewCsvRow[]; tasks: GenerationReviewTask[]; reviews: Record<string, ReviewValues>; reviewerId: string; reviewedAt: string }) {
  const taskByRow = new Map(options.tasks.flatMap((task) => task.sourceRowIds.map((rowId) => [rowId, task] as const)));
  const extraHeaders = ["review_status", "reviewer_id", "reviewed_at"];
  const headers = [...options.headers, ...extraHeaders];
  const records = options.rows.map((row) => {
    const task = taskByRow.get(rowIdFor(row));
    const review = task ? options.reviews[task.id] : undefined;
    const complete = task ? isReviewComplete(task, review) : false;
    const values: ReviewCsvRow = { ...row };
    for (const column of scoreColumns) values[column] = review?.[column] === undefined ? "" : String(review[column]);
    values.reviewer_notes = review?.reviewer_notes ?? "";
    values.review_status = complete ? "human-reviewed" : "incomplete";
    values.reviewer_id = complete ? options.reviewerId.trim() : "";
    values.reviewed_at = complete ? options.reviewedAt : "";
    return headers.map((header) => values[header] ?? "");
  });
  return [headers, ...records].map((record) => record.map(csvCell).join(",")).join("\n") + "\n";
}

function toTask(row: ReviewCsvRow, id: string, blindVariantId: string): GenerationReviewTask {
  return {
    id,
    sourceRowIds: [rowIdFor(row)],
    caseId: row.case_id,
    blindVariantId,
    answerability: row.answerability as "answerable" | "unanswerable",
    language: row.language,
    question: row.question,
    expectedKeyFacts: row.expected_key_facts.split(" | ").map((fact) => fact.trim()).filter(Boolean),
    frozenEvidence: row.frozen_evidence,
    candidateAnswer: row.candidate_answer,
  };
}

function rowIdFor(row: ReviewCsvRow) { return `${row.case_id}::${row.blind_variant_id}`; }
function csvCell(value: unknown) { const text = String(value).replace(/[ \t]+$/gm, ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
