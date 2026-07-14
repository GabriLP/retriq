import type { GoldenCase, GoldenEvidence } from "./golden-set";
import type { DocumentationChunk } from "./types";

export type RankedChunk = DocumentationChunk & { rank: number; score: number };

export type RetrievalCaseResult = {
  caseId: string;
  answerability: GoldenCase["answerability"];
  retrievedCount: number;
  relevantRetrieved: number;
  recallAtK: number | null;
  precisionAtK: number | null;
  reciprocalRank: number | null;
  ndcgAtK: number | null;
  falsePositive: boolean | null;
  rankedChunks: Array<{
    rank: number;
    score: number;
    chunkId: string;
    sourceId?: string;
    sourceUrl: string;
    pageStart?: number;
    pageEnd?: number;
    relevant: boolean;
  }>;
};

export function evaluateRetrievalCase(testCase: GoldenCase, rankedChunks: RankedChunk[]): RetrievalCaseResult {
  const ranked = rankedChunks.map((chunk) => ({
    rank: chunk.rank,
    score: chunk.score,
    chunkId: chunk.id,
    sourceId: chunk.sourceId,
    sourceUrl: chunk.sourceUrl,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    relevant: testCase.evidence.some((evidence) => matchesEvidence(chunk, evidence)),
  }));
  if (testCase.answerability === "unanswerable") {
    return {
      caseId: testCase.id,
      answerability: testCase.answerability,
      retrievedCount: ranked.length,
      relevantRetrieved: 0,
      recallAtK: null,
      precisionAtK: null,
      reciprocalRank: null,
      ndcgAtK: null,
      falsePositive: ranked.length > 0,
      rankedChunks: ranked,
    };
  }

  const relevantRetrieved = ranked.filter((chunk) => chunk.relevant).length;
  const firstRelevant = ranked.find((chunk) => chunk.relevant)?.rank;
  const distinctTargetsHit = testCase.evidence.filter((evidence) =>
    rankedChunks.some((chunk) => matchesEvidence(chunk, evidence)),
  ).length;
  const creditedEvidence = new Set<number>();
  const dcg = rankedChunks.reduce((total, chunk) => {
    const evidenceIndex = testCase.evidence.findIndex(
      (evidence, index) => !creditedEvidence.has(index) && matchesEvidence(chunk, evidence),
    );
    if (evidenceIndex < 0) return total;
    creditedEvidence.add(evidenceIndex);
    return total + 1 / Math.log2(chunk.rank + 1);
  }, 0);
  const idealCount = Math.min(testCase.evidence.length, ranked.length);
  const idealDcg = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2)).reduce(
    (total, value) => total + value,
    0,
  );
  return {
    caseId: testCase.id,
    answerability: testCase.answerability,
    retrievedCount: ranked.length,
    relevantRetrieved,
    recallAtK: distinctTargetsHit / Math.max(testCase.evidence.length, 1),
    precisionAtK: relevantRetrieved / Math.max(ranked.length, 1),
    reciprocalRank: firstRelevant ? 1 / firstRelevant : 0,
    ndcgAtK: idealDcg ? dcg / idealDcg : 0,
    falsePositive: null,
    rankedChunks: ranked,
  };
}

export function matchesEvidence(chunk: DocumentationChunk, evidence: GoldenEvidence) {
  const sourceMatches = evidence.sourceId
    ? chunk.sourceId === evidence.sourceId
    : evidence.sourceUrl === chunk.sourceUrl;
  if (!sourceMatches) return false;
  if (evidence.pageStart === undefined || evidence.pageEnd === undefined) return true;
  if (chunk.pageStart === undefined || chunk.pageEnd === undefined) return false;
  return chunk.pageStart <= evidence.pageEnd && chunk.pageEnd >= evidence.pageStart;
}

export function aggregateRetrievalMetrics(results: RetrievalCaseResult[]) {
  const answerable = results.filter((result) => result.answerability === "answerable");
  const unanswerable = results.filter((result) => result.answerability === "unanswerable");
  const metrics = {
    evaluatedCases: results.length,
    answerableCases: answerable.length,
    unanswerableCases: unanswerable.length,
    recallAtK: average(answerable.map((result) => result.recallAtK)),
    precisionAtK: average(answerable.map((result) => result.precisionAtK)),
    mrr: average(answerable.map((result) => result.reciprocalRank)),
    ndcgAtK: average(answerable.map((result) => result.ndcgAtK)),
    noAnswerFalsePositiveRate: average(unanswerable.map((result) => (result.falsePositive ? 1 : 0))),
  };
  for (const [name, value] of Object.entries(metrics)) {
    if (typeof value === "number" && !name.endsWith("Cases") && (value < 0 || value > 1)) {
      throw new Error(`Invalid retrieval metric ${name}=${value}; expected a value between 0 and 1.`);
    }
  }
  return metrics;
}

function average(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null;
}
