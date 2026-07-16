import { formatEmbeddingInput, usesPromptTaskInstructions, type EmbeddingTaskType } from "./embedding-input";
import { getGeminiClient } from "./gemini-client";

export type EmbeddingProvider = "google" | "openai" | "voyage";

export function formatProviderEmbeddingInput(
  text: string,
  options: { provider: EmbeddingProvider; model: string; taskType: EmbeddingTaskType; title?: string },
) {
  return options.provider === "google"
    ? formatEmbeddingInput(text, options.model, options.taskType, options.title)
    : text;
}

export async function embedProviderBatch(
  texts: string[],
  options: { provider: EmbeddingProvider; model: string; taskType: EmbeddingTaskType; outputDimensionality?: number },
) {
  const vectors = await withRetry(() => {
    if (options.provider === "google") return embedGoogle(texts, options);
    if (options.provider === "openai") return embedOpenAi(texts, options);
    return embedVoyage(texts, options);
  });
  validateVectors(vectors, texts.length, options);
  return vectors;
}

async function embedGoogle(
  texts: string[],
  options: { model: string; taskType: EmbeddingTaskType; outputDimensionality?: number },
) {
  const gemini = getGeminiClient();
  const response = await gemini.models.embedContent({
    model: options.model,
    contents: texts.map((text) => ({ parts: [{ text }] })),
    config: {
      ...(usesPromptTaskInstructions(options.model) ? {} : { taskType: options.taskType }),
      outputDimensionality: options.outputDimensionality,
    },
  });
  return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
}

async function embedOpenAi(
  texts: string[],
  options: { model: string; outputDimensionality?: number },
) {
  const apiKey = requiredEnvironmentVariable("OPENAI_API_KEY", "OpenAI embeddings");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      input: texts,
      encoding_format: "float",
      ...(options.outputDimensionality ? { dimensions: options.outputDimensionality } : {}),
    }),
  });
  const payload = await readJsonResponse<{ data?: Array<{ index: number; embedding: number[] }> }>(response, "OpenAI");
  return [...(payload.data ?? [])].sort((left, right) => left.index - right.index).map((item) => item.embedding);
}

async function embedVoyage(
  texts: string[],
  options: { model: string; taskType: EmbeddingTaskType; outputDimensionality?: number },
) {
  const apiKey = requiredEnvironmentVariable("VOYAGE_API_KEY", "Voyage embeddings");
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      input: texts,
      input_type: options.taskType === "RETRIEVAL_DOCUMENT" ? "document" : "query",
      output_dtype: "float",
      ...(options.outputDimensionality ? { output_dimension: options.outputDimensionality } : {}),
    }),
  });
  const payload = await readJsonResponse<{ data?: Array<{ index: number; embedding: number[] }> }>(response, "Voyage");
  return [...(payload.data ?? [])].sort((left, right) => left.index - right.index).map((item) => item.embedding);
}

async function readJsonResponse<T>(response: Response, provider: string): Promise<T> {
  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(`${provider} embedding request failed (${response.status}): ${raw.slice(0, 500)}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${provider} embedding response was not valid JSON.`);
  }
}

function validateVectors(
  vectors: number[][],
  expected: number,
  options: { provider: string; model: string; outputDimensionality?: number },
) {
  if (vectors.length !== expected || vectors.some((vector) => !vector.length || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error(`${options.provider}/${options.model} returned ${vectors.length} valid embeddings for ${expected} inputs.`);
  }
  const dimensions = new Set(vectors.map((vector) => vector.length));
  if (dimensions.size !== 1) throw new Error(`${options.provider}/${options.model} returned inconsistent vector dimensions.`);
  if (options.outputDimensionality && !dimensions.has(options.outputDimensionality)) {
    throw new Error(`${options.provider}/${options.model} returned dimension ${[...dimensions][0]}, expected ${options.outputDimensionality}.`);
  }
}

function requiredEnvironmentVariable(name: string, purpose: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ${purpose}.`);
  return value;
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
