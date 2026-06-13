import { GoogleGenAI } from "@google/genai";

import { ragConfig } from "./config";

let client: GoogleGenAI | null = null;

export function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    // Failing early prevents silently producing incomplete local artifacts when
    // the embedding provider has not been configured.
    throw new Error("GEMINI_API_KEY is required to run retrieval generation or ingestion.");
  }

  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export async function embedTexts(texts: string[]) {
  const gemini = getGeminiClient();
  const vectors: number[][] = [];
  // Batching keeps ingestion practical without adding background jobs or queue
  // infrastructure to the local pipeline.
  const batchSize = 64;

  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize);
    const response = await gemini.models.embedContent({
      model: ragConfig.embeddingModel,
      contents: batch,
    });

    vectors.push(...(response.embeddings ?? []).map((item) => item.values ?? []));
  }

  return vectors;
}

export async function embedQuery(query: string) {
  const [embedding] = await embedTexts([query]);
  return embedding;
}
