import OpenAI from "openai";

import { ragConfig } from "./config";

let client: OpenAI | null = null;

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    // Failing early prevents silently producing incomplete local artifacts when
    // the embedding provider has not been configured.
    throw new Error("OPENAI_API_KEY is required to run retrieval generation or ingestion.");
  }

  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export async function embedTexts(texts: string[]) {
  const openai = getOpenAIClient();
  const vectors: number[][] = [];
  // Batching keeps ingestion practical without adding background jobs or queue
  // infrastructure to the local pipeline.
  const batchSize = 64;

  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize);
    const response = await openai.embeddings.create({
      model: ragConfig.embeddingModel,
      input: batch,
      encoding_format: "float",
    });

    vectors.push(...response.data.map((item) => item.embedding));
  }

  return vectors;
}

export async function embedQuery(query: string) {
  const [embedding] = await embedTexts([query]);
  return embedding;
}
