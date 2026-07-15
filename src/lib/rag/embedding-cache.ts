import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_MAGIC = Buffer.from("RTRQEMB1", "ascii");
const CACHE_HEADER_BYTES = CACHE_MAGIC.length + 4;

export type EmbeddingTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY";

export type EmbeddingCacheOptions = {
  cachePath: string;
  provider: string;
  model: string;
  taskType: EmbeddingTaskType;
  outputDimensionality?: number;
  charactersPerToken?: number;
  priceUsdPerMillionTokens?: number;
};

export type EmbeddingCachePlan = {
  schemaVersion: 1;
  provider: string;
  model: string;
  taskType: EmbeddingTaskType;
  outputDimensionality: number | null;
  cachePath: string;
  requestedTexts: number;
  uniqueTexts: number;
  deduplicatedTexts: number;
  cacheHits: number;
  cacheMisses: number;
  avoidedApiRequests: number;
  requestedCharacters: number;
  apiCharacters: number;
  estimatedRequestedTokens: number;
  estimatedApiTokens: number;
  estimatedAvoidedTokens: number;
  tokenEstimation: { method: "character-ratio"; charactersPerToken: number };
  priceUsdPerMillionTokens: number | null;
  estimatedApiCostUsd: number | null;
  estimatedAvoidedCostUsd: number | null;
};

type CacheRecord = {
  key: string;
  text: string;
  filePath: string;
  estimatedTokens: number;
};

export async function inspectEmbeddingCache(texts: string[], options: EmbeddingCacheOptions) {
  const records = uniqueCacheRecords(texts, options);
  const hitKeys = new Set<string>();

  await mapWithConcurrency(records, 32, async (record) => {
    if (await isValidCacheEntry(record.filePath)) hitKeys.add(record.key);
  });

  return buildPlan(texts, records, hitKeys, options);
}

export function createEmbeddingCachePlan(
  texts: string[],
  options: EmbeddingCacheOptions,
  hitKeys = new Set<string>(),
) {
  return buildPlan(texts, uniqueCacheRecords(texts, options), hitKeys, options);
}

export async function readEmbeddingCache(
  texts: string[],
  options: EmbeddingCacheOptions,
): Promise<{ records: CacheRecord[]; vectorsByKey: Map<string, number[]>; plan: EmbeddingCachePlan }> {
  const records = uniqueCacheRecords(texts, options);
  const vectorsByKey = new Map<string, number[]>();

  await mapWithConcurrency(records, 32, async (record) => {
    const vector = await readCacheEntry(record.filePath);
    if (vector) vectorsByKey.set(record.key, vector);
  });

  return { records, vectorsByKey, plan: buildPlan(texts, records, new Set(vectorsByKey.keys()), options) };
}

export async function writeEmbeddingCacheEntry(filePath: string, vector: number[]) {
  if (!vector.length || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Cannot cache an empty or non-finite embedding vector.");
  }

  const buffer = Buffer.allocUnsafe(CACHE_HEADER_BYTES + vector.length * 8);
  CACHE_MAGIC.copy(buffer, 0);
  buffer.writeUInt32LE(vector.length, CACHE_MAGIC.length);
  vector.forEach((value, index) => buffer.writeDoubleLE(value, CACHE_HEADER_BYTES + index * 8));

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, buffer, { flag: "wx" });
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (await isValidCacheEntry(filePath)) {
      await fs.rm(temporaryPath, { force: true });
    } else {
      await fs.rm(filePath, { force: true });
      try {
        await fs.rename(temporaryPath, filePath);
      } catch (replacementError) {
        await fs.rm(temporaryPath, { force: true });
        throw replacementError instanceof Error ? replacementError : error;
      }
    }
  }
}

export function cacheRecordForText(text: string, options: EmbeddingCacheOptions): CacheRecord {
  const inputHash = sha256(text);
  const descriptor = JSON.stringify({
    schemaVersion: CACHE_SCHEMA_VERSION,
    provider: options.provider,
    model: options.model,
    taskType: options.taskType,
    outputDimensionality: options.outputDimensionality ?? null,
    inputHash,
  });
  const key = sha256(descriptor);
  const dimension = options.outputDimensionality ? String(options.outputDimensionality) : "default";
  const filePath = path.join(
    options.cachePath,
    `v${CACHE_SCHEMA_VERSION}`,
    slug(options.provider),
    slug(options.model),
    slug(options.taskType),
    dimension,
    key.slice(0, 2),
    `${key}.bin`,
  );
  return {
    key,
    text,
    filePath,
    estimatedTokens: estimateTokens(text, options.charactersPerToken),
  };
}

async function readCacheEntry(filePath: string) {
  try {
    const buffer = await fs.readFile(filePath);
    if (!validHeader(buffer)) return null;
    const dimension = buffer.readUInt32LE(CACHE_MAGIC.length);
    if (!dimension || buffer.length !== CACHE_HEADER_BYTES + dimension * 8) return null;
    const vector = Array.from({ length: dimension }, (_, index) =>
      buffer.readDoubleLE(CACHE_HEADER_BYTES + index * 8),
    );
    return vector.every(Number.isFinite) ? vector : null;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function isValidCacheEntry(filePath: string) {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const header = Buffer.alloc(CACHE_HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, CACHE_HEADER_BYTES, 0);
    if (bytesRead !== CACHE_HEADER_BYTES || !validHeader(header)) return false;
    const dimension = header.readUInt32LE(CACHE_MAGIC.length);
    const stat = await handle.stat();
    return dimension > 0 && stat.size === CACHE_HEADER_BYTES + dimension * 8;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

function uniqueCacheRecords(texts: string[], options: EmbeddingCacheOptions) {
  const records = new Map<string, CacheRecord>();
  for (const text of texts) {
    const record = cacheRecordForText(text, options);
    if (!records.has(record.key)) records.set(record.key, record);
  }
  return [...records.values()];
}

function buildPlan(
  texts: string[],
  records: CacheRecord[],
  hitKeys: Set<string>,
  options: EmbeddingCacheOptions,
): EmbeddingCachePlan {
  const charactersPerToken = validPositive(options.charactersPerToken) ?? 4;
  const requestedCharacters = texts.reduce((total, text) => total + text.length, 0);
  const estimatedRequestedTokens = texts.reduce(
    (total, text) => total + estimateTokens(text, charactersPerToken),
    0,
  );
  const misses = records.filter((record) => !hitKeys.has(record.key));
  const apiCharacters = misses.reduce((total, record) => total + record.text.length, 0);
  const estimatedApiTokens = misses.reduce((total, record) => total + record.estimatedTokens, 0);
  const estimatedAvoidedTokens = estimatedRequestedTokens - estimatedApiTokens;
  const price = validNonNegative(options.priceUsdPerMillionTokens);

  return {
    schemaVersion: 1,
    provider: options.provider,
    model: options.model,
    taskType: options.taskType,
    outputDimensionality: options.outputDimensionality ?? null,
    cachePath: path.resolve(options.cachePath),
    requestedTexts: texts.length,
    uniqueTexts: records.length,
    deduplicatedTexts: texts.length - records.length,
    cacheHits: hitKeys.size,
    cacheMisses: misses.length,
    avoidedApiRequests: texts.length - misses.length,
    requestedCharacters,
    apiCharacters,
    estimatedRequestedTokens,
    estimatedApiTokens,
    estimatedAvoidedTokens,
    tokenEstimation: { method: "character-ratio", charactersPerToken },
    priceUsdPerMillionTokens: price,
    estimatedApiCostUsd: price === null ? null : (estimatedApiTokens / 1_000_000) * price,
    estimatedAvoidedCostUsd: price === null ? null : (estimatedAvoidedTokens / 1_000_000) * price,
  };
}

function estimateTokens(text: string, charactersPerToken = 4) {
  const ratio = validPositive(charactersPerToken) ?? 4;
  return text.length ? Math.ceil(text.length / ratio) : 0;
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await operation(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

function validHeader(buffer: Buffer) {
  return buffer.length >= CACHE_HEADER_BYTES && buffer.subarray(0, CACHE_MAGIC.length).equals(CACHE_MAGIC);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function validPositive(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function validNonNegative(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
