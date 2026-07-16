import { ragConfig } from "./config";
import { formatEmbeddingInput } from "./embedding-input";
import { getGeminiClient } from "./gemini-client";

export async function embedQuery(query: string, model = ragConfig.embeddingModel) {
  const response = await getGeminiClient().models.embedContent({
    model,
    contents: formatEmbeddingInput(query, model, "QUESTION_ANSWERING"),
    config: { outputDimensionality: ragConfig.embeddingOutputDimensionality },
  });
  const vector = response.embeddings?.[0]?.values ?? [];
  if (!vector.length || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Gemini did not return a valid embedding for the query.");
  }
  return vector;
}
