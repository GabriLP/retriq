import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  cacheRecordForText,
  inspectEmbeddingCache,
  readEmbeddingCache,
  writeEmbeddingCacheEntry,
  type EmbeddingCacheOptions,
} from "../src/lib/rag/embedding-cache";
import { embedTextsWithCache, formatEmbeddingInput } from "../src/lib/rag/embeddings";
import { formatProviderEmbeddingInput } from "../src/lib/rag/embedding-providers";

async function main() {
  const cachePath = await fs.mkdtemp(path.join(os.tmpdir(), "retriq-embedding-cache-"));
  const options: EmbeddingCacheOptions = {
    cachePath,
    provider: "google",
    model: "test-model",
    taskType: "RETRIEVAL_DOCUMENT",
    charactersPerToken: 4,
    priceUsdPerMillionTokens: 2,
  };

  try {
    assert.equal(
      formatEmbeddingInput("How do caches work?", "gemini-embedding-2", "QUESTION_ANSWERING"),
      "task: question answering | query: How do caches work?",
    );
    assert.equal(
      formatProviderEmbeddingInput("raw OpenAI input", { provider: "openai", model: "text-embedding-3-large", taskType: "RETRIEVAL_DOCUMENT", title: "Ignored" }),
      "raw OpenAI input",
    );
    assert.equal(
      formatProviderEmbeddingInput("raw Voyage input", { provider: "voyage", model: "voyage-code-3", taskType: "RETRIEVAL_QUERY" }),
      "raw Voyage input",
    );
    assert.equal(
      formatEmbeddingInput("Cache content", "gemini-embedding-2", "RETRIEVAL_DOCUMENT", "Caching"),
      "title: Caching | text: Cache content",
    );
    assert.equal(
      formatEmbeddingInput("unchanged", "gemini-embedding-001", "RETRIEVAL_DOCUMENT", "Ignored"),
      "unchanged",
    );
    const empty = await inspectEmbeddingCache(["abcdefgh", "abcdefgh", "second"], options);
    assert.equal(empty.requestedTexts, 3);
    assert.equal(empty.uniqueTexts, 2);
    assert.equal(empty.deduplicatedTexts, 1);
    assert.equal(empty.cacheHits, 0);
    assert.equal(empty.cacheMisses, 2);
    assert.equal(empty.avoidedApiInputs, 1);

    const first = cacheRecordForText("abcdefgh", options);
    const expectedVector = [0.125, -0.5, Math.PI];
    await writeEmbeddingCacheEntry(first.filePath, expectedVector);

    const cached = await inspectEmbeddingCache(["abcdefgh", "abcdefgh", "second"], options);
    assert.equal(cached.cacheHits, 1);
    assert.equal(cached.cacheMisses, 1);
    assert.equal(cached.avoidedApiInputs, 2);
    assert.equal(cached.estimatedApiTokens, 2);
    assert.equal(cached.estimatedApiCostUsd, 0.000004);

    const loaded = await readEmbeddingCache(["abcdefgh"], options);
    assert.deepEqual(loaded.vectorsByKey.get(first.key), expectedVector);

    const queryPlan = await inspectEmbeddingCache(["abcdefgh"], { ...options, taskType: "RETRIEVAL_QUERY" });
    assert.equal(queryPlan.cacheHits, 0, "task type must be part of the cache identity");
    const modelPlan = await inspectEmbeddingCache(["abcdefgh"], { ...options, model: "other-model" });
    assert.equal(modelPlan.cacheHits, 0, "model must be part of the cache identity");
    const providerPlan = await inspectEmbeddingCache(["abcdefgh"], { ...options, provider: "openai" });
    assert.equal(providerPlan.cacheHits, 0, "provider must be part of the cache identity");
    const dimensionPlan = await inspectEmbeddingCache(["abcdefgh"], { ...options, outputDimensionality: 768 });
    assert.equal(dimensionPlan.cacheHits, 0, "output dimensionality must be part of the cache identity");

    const cacheOnly = await embedTextsWithCache(["abcdefgh"], {
      model: options.model,
      taskType: options.taskType,
      cachePath,
      allowProviderRequests: false,
    });
    assert.deepEqual(cacheOnly.vectors[0], expectedVector);
    assert.equal(cacheOnly.apiInputs, 0);
    await assert.rejects(
      embedTextsWithCache(["not-cached"], {
        model: options.model,
        taskType: options.taskType,
        cachePath,
        allowProviderRequests: false,
      }),
      /cache-only mode found 1 missing input/,
    );

    await fs.writeFile(first.filePath, "corrupted");
    const corrupted = await inspectEmbeddingCache(["abcdefgh"], options);
    assert.equal(corrupted.cacheHits, 0, "corrupted entries must be regenerated");
    assert.equal(corrupted.cacheMisses, 1);
    await writeEmbeddingCacheEntry(first.filePath, expectedVector);
    const repaired = await readEmbeddingCache(["abcdefgh"], options);
    assert.deepEqual(repaired.vectorsByKey.get(first.key), expectedVector, "corrupted entries must be replaceable");

    console.log("Embedding cache tests passed.");
  } finally {
    await fs.rm(cachePath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
