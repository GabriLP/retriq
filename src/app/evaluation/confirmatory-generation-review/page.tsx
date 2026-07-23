import fs from "node:fs/promises";
import path from "node:path";

import { GenerationReviewWorkbench } from "@/components/generation-review-workbench";
import { buildReviewTasks, parseCsv } from "@/lib/evaluation/generation-review";

export const metadata = {
  title: "Confirmatory generation review · Retriq",
  description: "Targeted human review of all model-generated answers in the confirmatory test.",
};

export default async function ConfirmatoryGenerationReviewPage() {
  const worksheet = await fs.readFile(
    path.join(process.cwd(), "docs/evaluation/generation-confirmatory-final-test-human-review-v2.csv"),
    "utf8",
  );
  const parsed = parseCsv(worksheet);
  const rows = parsed.rows.filter(
    (row) => row.answerability === "answerable" || row.frozen_evidence.trim().length > 0,
  );

  return (
    <GenerationReviewWorkbench
      headers={parsed.headers}
      rows={rows}
      tasks={buildReviewTasks(rows)}
      storageKey="retriq:generation-confirmatory-final-test-review:v2"
      exportFilename="generation-confirmatory-final-test-human-review-v2.completed.csv"
    />
  );
}
