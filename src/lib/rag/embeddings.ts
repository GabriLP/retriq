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

export async function embedTexts(
  texts: string[],
  options: { model?: string; concurrency?: number } = {},
) {
  const gemini = getGeminiClient();
  const vectors = new Array<number[]>(texts.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 8));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < texts.length) {
      const index = nextIndex;
      nextIndex += 1;
      const text = texts[index];
      const response = await gemini.models.embedContent({
        model: options.model ?? ragConfig.embeddingModel,
        contents: text,
      });
      const [embedding] = response.embeddings ?? [];
      const vector = embedding?.values ?? [];

      if (!vector.length) {
        throw new Error("Gemini did not return a valid embedding for one of the requested texts.");
      }

      vectors[index] = vector;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, () => worker()));

  return vectors;
}

export async function embedQuery(query: string, model?: string) {
  const [embedding] = await embedTexts([query], { model });
  if (!embedding?.length) {
    throw new Error("Gemini did not return a valid embedding for the query.");
  }

  return embedding;
}
