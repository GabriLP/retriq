import fs from "node:fs/promises";
import path from "node:path";

import { SemanticEvidenceReviewWorkbench } from "@/components/semantic-evidence-review-workbench";
import type { SemanticEvidenceReviewTask } from "@/lib/evaluation/semantic-evidence-review";
import type { DocumentationChunk } from "@/lib/rag/types";

export const metadata = {
  title: "Evidence benchmark v2 · Retriq",
  description: "Blinded human review of the independent evidence-sufficiency benchmark.",
};

type SeedQuestion = { id: string; technology: string; question: string };
type Packet = {
  id: string;
  caseId: string;
  evidence: Array<{ id: string; sourceId: string | null; score: number; rank: number }>;
};

export default async function SemanticEvidenceBenchmarkV2ReviewPage() {
  const [benchmarkRaw, seedRaw, chunksRaw] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "docs/evaluation/semantic-evidence-benchmark.v2.json"), "utf8"),
    fs.readFile(path.join(process.cwd(), "docs/evaluation/semantic-evidence-benchmark.v2.seed.json"), "utf8"),
    fs.readFile(path.join(process.cwd(), "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec/chunks.json"), "utf8"),
  ]);
  const benchmark = JSON.parse(benchmarkRaw) as { reviewOrder: string[]; states: Packet[] };
  const questions = new Map((JSON.parse(seedRaw) as { questions: SeedQuestion[] }).questions.map((item) => [item.id, item]));
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  const chunksById = new Map<string, DocumentationChunk[]>();
  for (const chunk of chunks) chunksById.set(chunk.id, [...(chunksById.get(chunk.id) ?? []), chunk]);
  const packets = new Map(benchmark.states.map((item) => [item.id, item]));
  const tasks: SemanticEvidenceReviewTask[] = benchmark.reviewOrder.map((stateId) => {
    const packet = packets.get(stateId);
    if (!packet) throw new Error(`Missing frozen benchmark packet ${stateId}.`);
    const question = questions.get(packet.caseId);
    if (!question) throw new Error(`Missing frozen benchmark question ${packet.caseId}.`);
    return {
      id: packet.id,
      caseId: packet.caseId,
      displayLabel: question.technology,
      question: question.question,
      attempt: 1,
      excerpts: packet.evidence.map((evidence) => {
        const candidates = chunksById.get(evidence.id) ?? [];
        const chunk = candidates.find((item) => !evidence.sourceId || item.sourceId === evidence.sourceId) ?? candidates[0];
        if (!chunk) throw new Error(`Missing frozen benchmark chunk ${evidence.id}.`);
        return {
          label: `S${evidence.rank}`,
          title: chunk.title,
          section: chunk.section,
          sourceUrl: chunk.sourceUrl,
          sourceId: evidence.sourceId,
          language: chunk.language ?? null,
          score: evidence.score,
          content: chunk.content,
        };
      }),
    };
  });
  return <SemanticEvidenceReviewWorkbench tasks={tasks} study={{
    eyebrow: "Retriq · independent study",
    heading: "Evidence benchmark v2",
    storageKey: "retriq:semantic-evidence-benchmark-v2-review:v1",
    sourceExperiment: "agentic-semantic-assessor-v2",
    exportFileName: "semantic-evidence-benchmark-v2-human-review.completed.csv",
    backupFileName: "semantic-evidence-benchmark-v2-human-review.progress.json",
  }} />;
}
