import { GoogleGenAI } from "@google/genai";

import { ragConfig } from "./config";
import {
  cacheRecordForText,
  createEmbeddingCachePlan,
  readEmbeddingCache,
  writeEmbeddingCacheEntry,
  type EmbeddingCachePlan,
  type EmbeddingTaskType,
} from "./embedding-cache";

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
  options: EmbedTextsOptions = {},
) {
  return (await embedTextsWithCache(texts, options)).vectors;
}

export type EmbedTextsOptions = {
  model?: string;
  concurrency?: number;
  taskType?: EmbeddingTaskType;
  outputDimensionality?: number;
  cache?: boolean;
  cachePath?: string;
  charactersPerToken?: number;
  priceUsdPerMillionTokens?: number;
};

export type EmbedTextsResult = {
  vectors: number[][];
  cache: EmbeddingCachePlan;
  apiRequests: number;
  cacheWrites: number;
};

export async function embedTextsWithCache(
  texts: string[],
  options: EmbedTextsOptions = {},
): Promise<EmbedTextsResult> {
  if (!texts.length) {
    throw new Error("At least one text is required to generate embeddings.");
  }

  const model = options.model ?? ragConfig.embeddingModel;
  const taskType = options.taskType ?? "SEMANTIC_SIMILARITY";
  const cacheEnabled = options.cache ?? ragConfig.embeddingCacheEnabled;
  const cacheOptions = {
    cachePath: options.cachePath ?? ragConfig.embeddingCachePath,
    provider: "google",
    model,
    taskType,
    outputDimensionality: options.outputDimensionality,
    charactersPerToken: options.charactersPerToken ?? ragConfig.embeddingCharactersPerToken,
    priceUsdPerMillionTokens:
      options.priceUsdPerMillionTokens ?? ragConfig.embeddingPriceUsdPerMillionTokens,
  };
  const cacheState = await readEmbeddingCache(cacheEnabled ? texts : [], cacheOptions);
  const records = texts.map((text) => cacheRecordForText(text, cacheOptions));
  const vectorsByKey = cacheState.vectorsByKey;
  const missingRecords = [...new Map(records.filter((record) => !vectorsByKey.has(record.key)).map((record) => [record.key, record])).values()];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 8));
  let nextIndex = 0;
  let cacheWrites = 0;

  async function worker() {
    while (nextIndex < missingRecords.length) {
      const record = missingRecords[nextIndex];
      nextIndex += 1;
      const vector = await embedOne(record.text, { model, taskType, outputDimensionality: options.outputDimensionality });
      vectorsByKey.set(record.key, vector);
      if (cacheEnabled) {
        await writeEmbeddingCacheEntry(record.filePath, vector);
        cacheWrites += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, missingRecords.length) }, () => worker()));
  const vectors = records.map((record) => {
    const vector = vectorsByKey.get(record.key);
    if (!vector) throw new Error(`Embedding ${record.key} was neither cached nor generated.`);
    return vector;
  });

  const cache = cacheEnabled
    ? cacheState.plan
    : createEmbeddingCachePlan(texts, cacheOptions);

  return { vectors, cache, apiRequests: missingRecords.length, cacheWrites };
}

async function embedOne(
  text: string,
  options: { model: string; taskType: EmbeddingTaskType; outputDimensionality?: number },
) {
  const gemini = getGeminiClient();
  const response = await gemini.models.embedContent({
    model: options.model,
    contents: text,
    config: {
      taskType: options.taskType,
      outputDimensionality: options.outputDimensionality,
    },
  });
  const [embedding] = response.embeddings ?? [];
  const vector = embedding?.values ?? [];
  if (!vector.length || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Gemini did not return a valid embedding for one of the requested texts.");
  }
  return vector;
}

export async function embedQuery(query: string, model?: string) {
  const [embedding] = await embedTexts([query], { model, taskType: "RETRIEVAL_QUERY" });
  if (!embedding?.length) {
    throw new Error("Gemini did not return a valid embedding for the query.");
  }

  return embedding;
}
