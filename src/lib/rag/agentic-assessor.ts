import { assessEvidenceCoverage, type EvidenceAssessment } from "./agentic-retrieval";
import { detectQueryMetadataConstraint } from "./metadata-filter";
import type { RetrievalResult } from "./types";

export function assessAgenticEvidence(input: { question: string; chunks: RetrievalResult[]; minimumTopScore?: number }): EvidenceAssessment {
  const constraint = detectQueryMetadataConstraint(input.question);
  return assessEvidenceCoverage({
    question: input.question,
    chunks: input.chunks,
    minimumTopScore: input.minimumTopScore ?? 0.68,
    requiredLanguages: constraint?.databaseLanguages ?? [],
  });
}
