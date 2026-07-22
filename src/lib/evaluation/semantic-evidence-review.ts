export type SemanticEvidenceReviewTask = {
  id: string;
  caseId: string;
  displayLabel?: string;
  question: string;
  attempt: number;
  excerpts: Array<{
    label: string;
    title: string;
    section: string;
    sourceUrl: string;
    sourceId: string | null;
    language: string | null;
    score: number;
    content: string;
  }>;
};

export type SemanticEvidenceReviewEntry = {
  sufficient?: boolean;
  notes?: string;
  reviewedAt?: string;
};

export function exportSemanticEvidenceReviewCsv(input: { tasks: SemanticEvidenceReviewTask[]; reviews: Record<string, SemanticEvidenceReviewEntry>; reviewer: string; exportedAt: string; sourceExperiment?: string }) {
  const rows = input.tasks.map((task) => {
    const review = input.reviews[task.id];
    if (review?.sufficient === undefined) throw new Error(`Incomplete semantic evidence review ${task.id}.`);
    return [1, task.id, task.caseId, task.attempt, review.sufficient ? 1 : 0, review.notes ?? "", input.reviewer, review.reviewedAt ?? input.exportedAt, input.sourceExperiment ?? "agentic-semantic-assessor-v1"];
  });
  return [["schema_version", "state_id", "case_id", "attempt", "human_sufficient_0_1", "reviewer_notes", "reviewed_by", "reviewed_at", "source_experiment"], ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n";
}

function csv(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
