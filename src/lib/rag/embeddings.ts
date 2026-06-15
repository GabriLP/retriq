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

  for (const text of texts) {
    const response = await gemini.models.embedContent({
      model: ragConfig.embeddingModel,
      contents: text,
    });
    const [embedding] = response.embeddings ?? [];
    const vector = embedding?.values ?? [];

    if (!vector.length) {
      throw new Error("Gemini did not return a valid embedding for one of the requested texts.");
    }

    vectors.push(vector);
  }

  return vectors;
}

export async function embedQuery(query: string) {
  const [embedding] = await embedTexts([query]);
  if (!embedding?.length) {
    throw new Error("Gemini did not return a valid embedding for the query.");
  }

  return embedding;
}
