import path from "node:path";

import { readLocalReviewFiles } from "@/lib/evaluation/local-review-files";
import { SemanticEvidenceReviewWorkbench } from "@/components/semantic-evidence-review-workbench";
import type { SemanticEvidenceReviewTask } from "@/lib/evaluation/semantic-evidence-review";
import type { DocumentationChunk } from "@/lib/rag/types";

export const metadata = { title: "Evidence audit · Retriq", description: "Blinded human review of alternative retrieval evidence." };

type Observation = { stateId: string; caseId: string; attempt: number; expectedSufficient: boolean; semanticSufficient: boolean; retrieved: Array<{ rank: number; id: string; sourceId?: string; language?: string; section: string; score: number }> };

export default async function SemanticEvidenceReviewPage() {
  const [resultRaw, chunksRaw, goldenRaw, positivesRaw, negativesRaw] = await readLocalReviewFiles([
    path.join(process.cwd(), "docs/experiment-results/agentic-semantic-assessor-v1-validation.json"),
    path.join(process.cwd(), "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec/chunks.json"),
    path.join(process.cwd(), "docs/evaluation/golden-set.v4.json"),
    path.join(process.cwd(), "docs/evaluation/multi-technology-retrieval-benchmark.v1.json"),
    path.join(process.cwd(), "docs/evaluation/multi-technology-negative-benchmark.v1.json"),
  ]);
  const observations = (JSON.parse(resultRaw) as { observations: Observation[] }).observations.filter((item) => !item.expectedSufficient && item.semanticSufficient);
  if (observations.length !== 3) throw new Error(`Expected exactly three frozen semantic disagreements, received ${observations.length}.`);
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  const chunksById = new Map<string, DocumentationChunk[]>();
  for (const chunk of chunks) chunksById.set(chunk.id, [...(chunksById.get(chunk.id) ?? []), chunk]);
  const questions = questionMap(JSON.parse(goldenRaw), JSON.parse(positivesRaw), JSON.parse(negativesRaw));
  const tasks: SemanticEvidenceReviewTask[] = observations.map((observation) => ({
    id: observation.stateId,
    caseId: observation.caseId,
    question: questions.get(observation.caseId) ?? observation.caseId,
    attempt: observation.attempt,
    excerpts: observation.retrieved.map((retrieved) => {
      const candidates = chunksById.get(retrieved.id) ?? [];
      const chunk = candidates.find((item) => (!retrieved.sourceId || item.sourceId === retrieved.sourceId) && (!retrieved.language || item.language === retrieved.language)) ?? candidates[0];
      if (!chunk) throw new Error(`Missing frozen review chunk ${retrieved.id}.`);
      return { label: `S${retrieved.rank}`, title: chunk.title, section: chunk.section, sourceUrl: chunk.sourceUrl, sourceId: chunk.sourceId ?? null, language: chunk.language ?? null, score: retrieved.score, content: chunk.content };
    }),
  }));
  return <SemanticEvidenceReviewWorkbench tasks={tasks} />;
}

function questionMap(golden: { cases: Array<{ id: string; question: string }> }, positives: { cases: Array<{ id: string; question: string }> }, negatives: { cases: Array<{ id: string; question: string }> }) {
  return new Map([...golden.cases, ...positives.cases, ...negatives.cases].map((item) => [item.id, item.question]));
}
