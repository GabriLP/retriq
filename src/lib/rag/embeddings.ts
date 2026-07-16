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
  titles?: Array<string | undefined>;
  batchSize?: number;
  onProgress?: (progress: { completedInputs: number; totalInputs: number; apiRequests: number }) => void;
};

export type EmbedTextsResult = {
  vectors: number[][];
  cache: EmbeddingCachePlan;
  apiRequests: number;
  apiInputs: number;
  cacheWrites: number;
};

export async function embedTextsWithCache(
  texts: string[],
  options: EmbedTextsOptions = {},
): Promise<EmbedTextsResult> {
  if (!texts.length) {
    throw new Error("At least one text is required to generate embeddings.");
  }
  if (options.titles && options.titles.length !== texts.length) {
    throw new Error("Embedding titles must have the same length as embedding texts.");
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
  const providerTexts = texts.map((text, index) =>
    formatEmbeddingInput(text, model, taskType, options.titles?.[index]),
  );
  const cacheState = await readEmbeddingCache(cacheEnabled ? providerTexts : [], cacheOptions);
  const records = providerTexts.map((text) => cacheRecordForText(text, cacheOptions));
  const vectorsByKey = cacheState.vectorsByKey;
  const missingRecords = [...new Map(records.filter((record) => !vectorsByKey.has(record.key)).map((record) => [record.key, record])).values()];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 8));
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 32, 100));
  const batches = chunk(missingRecords, batchSize);
  let nextIndex = 0;
  let cacheWrites = 0;
  let apiRequests = 0;
  let completedInputs = 0;

  async function worker() {
    while (nextIndex < batches.length) {
      const batch = batches[nextIndex];
      nextIndex += 1;
      const vectors = await embedBatch(batch.map((record) => record.text), {
        model,
        taskType,
        outputDimensionality: options.outputDimensionality,
      });
      apiRequests += 1;
      for (let index = 0; index < batch.length; index += 1) {
        const record = batch[index];
        const vector = vectors[index];
        vectorsByKey.set(record.key, vector);
        if (cacheEnabled) {
          await writeEmbeddingCacheEntry(record.filePath, vector);
          cacheWrites += 1;
        }
      }
      completedInputs += batch.length;
      options.onProgress?.({ completedInputs, totalInputs: missingRecords.length, apiRequests });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));
  const vectors = records.map((record) => {
    const vector = vectorsByKey.get(record.key);
    if (!vector) throw new Error(`Embedding ${record.key} was neither cached nor generated.`);
    return vector;
  });

  const cache = cacheEnabled
    ? cacheState.plan
    : createEmbeddingCachePlan(providerTexts, cacheOptions);

  return { vectors, cache, apiRequests, apiInputs: missingRecords.length, cacheWrites };
}

async function embedBatch(
  texts: string[],
  options: { model: string; taskType: EmbeddingTaskType; outputDimensionality?: number },
) {
  const gemini = getGeminiClient();
  const response = await withRetry(() =>
    gemini.models.embedContent({
      model: options.model,
      contents: texts.map((text) => ({ parts: [{ text }] })),
      config: {
        ...(usesPromptTaskInstructions(options.model) ? {} : { taskType: options.taskType }),
        outputDimensionality: options.outputDimensionality,
      },
    }),
  );
  const vectors = (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
  if (
    vectors.length !== texts.length ||
    vectors.some((vector) => !vector.length || vector.some((value) => !Number.isFinite(value)))
  ) {
    throw new Error(`Gemini returned ${vectors.length} valid embeddings for ${texts.length} requested texts.`);
  }
  return vectors;
}

export async function embedQuery(query: string, model?: string) {
  const [embedding] = await embedTexts([query], { model, taskType: "QUESTION_ANSWERING" });
  if (!embedding?.length) {
    throw new Error("Gemini did not return a valid embedding for the query.");
  }

  return embedding;
}

export function formatEmbeddingInput(
  text: string,
  model: string,
  taskType: EmbeddingTaskType,
  title?: string,
) {
  if (!usesPromptTaskInstructions(model)) return text;
  if (taskType === "RETRIEVAL_DOCUMENT") {
    return `title: ${title?.trim() || "none"} | text: ${text}`;
  }
  const task =
    taskType === "QUESTION_ANSWERING"
      ? "question answering"
      : taskType === "CODE_RETRIEVAL_QUERY"
        ? "code retrieval"
        : taskType === "SEMANTIC_SIMILARITY"
          ? "sentence similarity"
          : "search result";
  return `task: ${task} | query: ${text}`;
}

function usesPromptTaskInstructions(model: string) {
  return model.replace(/^models\//, "").startsWith("gemini-embedding-2");
}

async function withRetry<T>(operation: () => Promise<T>, maximumAttempts = 7): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maximumAttempts || !isRetryableProviderError(error)) throw error;
      const delayMs = Math.min(30_000, 750 * 2 ** (attempt - 1)) + Math.round(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isRetryableProviderError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = "status" in error ? Number((error as Error & { status?: number }).status) : undefined;
  return status === 429 || (status !== undefined && status >= 500) || /429|resource_exhausted|rate limit|temporar/i.test(error.message);
}

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}
