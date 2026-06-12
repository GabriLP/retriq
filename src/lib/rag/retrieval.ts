import { ragConfig } from "./config";
import { embedQuery } from "./embeddings";
import { cosineSimilarity, readVectorStore } from "./vector-store";

export async function retrieveRelevantChunks(question: string, topK = ragConfig.defaultTopK) {
  const [queryEmbedding, store] = await Promise.all([embedQuery(question), readVectorStore()]);

  return store.chunks
    .map(({ embedding, ...chunk }) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, embedding),
    }))
    // The threshold removes very weak matches before generation, making
    // insufficient-context cases visible instead of hiding them in the prompt.
    .filter((chunk) => chunk.score >= ragConfig.minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK)
    .map((chunk, index) => ({
      ...chunk,
      rank: index + 1,
      // Rounded scores are easier to read in logs and transparency panels.
      score: Number(chunk.score.toFixed(4)),
    }));
}
