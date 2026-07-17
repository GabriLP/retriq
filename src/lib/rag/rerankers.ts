import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type RerankerResult = { index: number; relevanceScore: number };

export type RerankDocumentsResult = {
  results: RerankerResult[];
  cacheHit: boolean;
  apiRequests: number;
  processedTokens: number;
  estimatedCostUsd: number;
};

type CacheRecord = {
  schemaVersion: 1;
  provider: "voyage";
  model: string;
  results: RerankerResult[];
  processedTokens: number;
};

type VoyageResponse = {
  data?: Array<{ index?: unknown; relevance_score?: unknown }>;
  results?: Array<{ index?: unknown; relevance_score?: unknown }>;
  usage?: { total_tokens?: unknown };
};

export async function rerankDocuments(
  query: string,
  documents: string[],
  options: {
    model: string;
    topK?: number;
    cachePath?: string;
    allowProviderRequests?: boolean;
    priceUsdPerMillionTokens: number;
    apiKey?: string;
    fetchImplementation?: typeof fetch;
  },
): Promise<RerankDocumentsResult> {
  if (!query.trim()) throw new Error("Reranking requires a non-empty query.");
  if (!documents.length) return { results: [], cacheHit: true, apiRequests: 0, processedTokens: 0, estimatedCostUsd: 0 };
  if (documents.length > 1000) throw new Error("Voyage reranking accepts at most 1000 documents.");
  const topK = options.topK ?? documents.length;
  if (topK < 1 || topK > documents.length) throw new Error("Reranker topK must be between 1 and the document count.");
  const cacheRoot = path.resolve(options.cachePath ?? "data/reranker-cache");
  const key = crypto.createHash("sha256").update(JSON.stringify({ provider: "voyage", model: options.model, query, documents, topK })).digest("hex");
  const cacheFile = path.join(cacheRoot, "voyage", safeSegment(options.model), `${key}.json`);
  const cached = await readCache(cacheFile);
  if (cached) return summarize(cached, true, options.priceUsdPerMillionTokens);
  if (options.allowProviderRequests === false) throw new Error(`Reranker cache-only mode missed ${key}.`);

  const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is required for Voyage reranking.");
  const response = await (options.fetchImplementation ?? fetch)("https://api.voyageai.com/v1/rerank", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, documents, model: options.model, top_k: topK, return_documents: false, truncation: false }),
  });
  if (!response.ok) throw new Error(`Voyage reranking failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = (await response.json()) as VoyageResponse;
  const rawResults = payload.data ?? payload.results;
  if (!Array.isArray(rawResults)) throw new Error("Voyage reranking returned no result array.");
  const results = rawResults.map((item) => ({ index: numberField(item.index, "index"), relevanceScore: numberField(item.relevance_score, "relevance_score") }));
  validateResults(results, documents.length);
  const reportedTokens = typeof payload.usage?.total_tokens === "number" ? payload.usage.total_tokens : null;
  const record: CacheRecord = {
    schemaVersion: 1,
    provider: "voyage",
    model: options.model,
    results,
    processedTokens: reportedTokens ?? estimateRerankerTokens(query, documents),
  };
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, `${JSON.stringify(record, null, 2)}\n`);
  return summarize(record, false, options.priceUsdPerMillionTokens);
}

export function estimateRerankerTokens(query: string, documents: string[], charactersPerToken = 4) {
  const queryTokens = Math.ceil(query.length / charactersPerToken);
  const documentTokens = documents.reduce((total, document) => total + Math.ceil(document.length / charactersPerToken), 0);
  return queryTokens * documents.length + documentTokens;
}

async function readCache(file: string) {
  try {
    const record = JSON.parse(await fs.readFile(file, "utf8")) as CacheRecord;
    return record.schemaVersion === 1 && record.provider === "voyage" ? record : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function summarize(record: CacheRecord, cacheHit: boolean, price: number): RerankDocumentsResult {
  return {
    results: record.results,
    cacheHit,
    apiRequests: cacheHit ? 0 : 1,
    processedTokens: record.processedTokens,
    estimatedCostUsd: record.processedTokens / 1_000_000 * price,
  };
}

function validateResults(results: RerankerResult[], documentCount: number) {
  const indexes = new Set<number>();
  for (const result of results) {
    if (!Number.isInteger(result.index) || result.index < 0 || result.index >= documentCount) throw new Error(`Invalid reranker document index ${result.index}.`);
    if (indexes.has(result.index)) throw new Error(`Duplicate reranker document index ${result.index}.`);
    indexes.add(result.index);
  }
}

function numberField(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid Voyage reranker ${name}.`);
  return value;
}

function safeSegment(value: string) { return value.replace(/[^a-zA-Z0-9._-]/g, "_"); }
