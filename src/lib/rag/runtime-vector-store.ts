import { ragConfig } from "./config";
import { detectQueryMetadataConstraint } from "./metadata-filter";
import { searchPostgresChunks, readPostgresCorpusSummary } from "./postgres-vector-store";
import { cosineSimilarity, readCorpusSummary, readVectorStore } from "./vector-store";
import type { CorpusSummary, RetrievalResult } from "./types";

export async function readRuntimeCorpusSummary(): Promise<CorpusSummary> {
  return ragConfig.vectorStoreBackend === "postgres"
    ? readPostgresCorpusSummary()
    : readCorpusSummary();
}

export async function searchRuntimeVectorStore(question: string, queryEmbedding: number[], topK: number): Promise<RetrievalResult[]> {
  if (ragConfig.vectorStoreBackend === "postgres") {
    return searchPostgresChunks(queryEmbedding, topK, detectQueryMetadataConstraint(question));
  }
  const store = await readVectorStore();
  return store.chunks
    .map(({ embedding, ...chunk }) => ({ ...chunk, score: cosineSimilarity(queryEmbedding, embedding) }))
    .filter((chunk) => chunk.score >= ragConfig.minScore)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, topK)
    .map((chunk, index) => ({ ...chunk, rank: index + 1, score: Number(chunk.score.toFixed(4)) }));
}
