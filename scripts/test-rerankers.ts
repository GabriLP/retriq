import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { estimateRerankerTokens, rerankDocuments } from "../src/lib/rag/rerankers";

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "retriq-reranker-"));
  let requests = 0;
  const fakeFetch: typeof fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ data: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.2 }], usage: { total_tokens: 123 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const options = { model: "rerank-test", cachePath: directory, priceUsdPerMillionTokens: 0.05, apiKey: "test", fetchImplementation: fakeFetch };
  const first = await rerankDocuments("query", ["first", "second"], options);
  assert.equal(first.cacheHit, false);
  assert.equal(first.apiRequests, 1);
  assert.equal(first.processedTokens, 123);
  assert.deepEqual(first.results.map((item) => item.index), [1, 0]);
  const second = await rerankDocuments("query", ["first", "second"], { ...options, allowProviderRequests: false });
  assert.equal(second.cacheHit, true);
  assert.equal(second.apiRequests, 0);
  assert.equal(requests, 1);
  assert.equal(estimateRerankerTokens("1234", ["12345678", "1234"]), 5);
  await fs.rm(directory, { recursive: true, force: true });
  console.log("Reranker API mapping, token estimation, and cache reuse passed.");
}

main().catch((error) => { console.error(error); process.exit(1); });
