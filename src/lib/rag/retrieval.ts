import { ragConfig } from "./config";
import { embedQuery } from "./runtime-embeddings";
import { searchRuntimeVectorStore } from "./runtime-vector-store";

export async function retrieveRelevantChunks(question: string, topK = ragConfig.defaultTopK) {
  const queryEmbedding = await embedQuery(question);
  return searchRuntimeVectorStore(question, queryEmbedding, topK);
}
