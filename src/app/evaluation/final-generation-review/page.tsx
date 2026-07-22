import fs from "node:fs/promises";
import path from "node:path";

import { GenerationReviewWorkbench } from "@/components/generation-review-workbench";
import { buildReviewTasks, parseCsv } from "@/lib/evaluation/generation-review";

export const metadata = { title: "Final generation review · Retriq", description: "Final human review of the locked GLM generation test." };

export default async function FinalGenerationReviewPage() {
  const worksheet = await fs.readFile(path.join(process.cwd(), "docs/evaluation/generation-final-test-human-review-v1.csv"), "utf8");
  const { headers, rows } = parseCsv(worksheet);
  return <GenerationReviewWorkbench headers={headers} rows={rows} tasks={buildReviewTasks(rows)} storageKey="retriq:generation-final-test-review:v1" exportFilename="generation-final-test-human-review-v1.completed.csv" />;
}
