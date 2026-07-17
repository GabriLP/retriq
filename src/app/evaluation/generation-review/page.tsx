import fs from "node:fs/promises";
import path from "node:path";

import { GenerationReviewWorkbench } from "@/components/generation-review-workbench";
import { buildReviewTasks, parseCsv } from "@/lib/evaluation/generation-review";

export const metadata = {
  title: "Generation review · Retriq",
  description: "Blinded human review of grounded RAG answers.",
};

export default async function GenerationReviewPage() {
  const worksheet = await fs.readFile(path.join(process.cwd(), "docs/evaluation/generation-human-review-v1.csv"), "utf8");
  const { headers, rows } = parseCsv(worksheet);
  const tasks = buildReviewTasks(rows);
  return <GenerationReviewWorkbench headers={headers} rows={rows} tasks={tasks} />;
}
