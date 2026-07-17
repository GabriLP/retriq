import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { generateWithCandidate, type GeneratorCandidate } from "../src/lib/rag/generator-providers";

async function main() {
  process.env.OPENROUTER_API_KEY = "test-key";
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "retriq-generator-"));
  const candidate: GeneratorCandidate = {
    id: "glm-test",
    provider: "openrouter",
    model: "z-ai/glm-5.2-20260616",
    expectedResponseModel: "z-ai/glm-5.2-20260616",
    expectedResponseProvider: "Z.AI",
    providerOrder: ["z-ai/fp8"],
    allowFallbacks: false,
    reasoningEffort: "medium",
    inputPriceUsdPerMillionTokens: 1.4,
    outputPriceUsdPerMillionTokens: 4.4,
  };
  let requests = 0;
  let requestBody: Record<string, unknown> = {};
  const fakeFetch: typeof fetch = async (_input, init) => {
    requests += 1;
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "generation-1",
      model: candidate.model,
      provider: "Z.AI",
      choices: [{ message: { content: "Grounded answer [S1]." } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.000228, completion_tokens_details: { reasoning_tokens: 5 } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const options = { candidate, systemInstruction: "system", userPrompt: "prompt", temperature: 0, maxOutputTokens: 900, cacheDirectory: directory, fetchImplementation: fakeFetch };
  const first = await generateWithCandidate(options);
  assert.equal(first.cacheHit, false);
  assert.equal(first.usage.costSource, "provider-reported");
  assert.equal(first.usage.reasoningTokens, 5);
  assert.deepEqual(requestBody.provider, { order: ["z-ai/fp8"], allow_fallbacks: false });
  assert.equal(requestBody.model, candidate.model);
  assert.deepEqual(requestBody.reasoning, { effort: "medium" });
  const second = await generateWithCandidate({ ...options, allowProviderRequests: false });
  assert.equal(second.cacheHit, true);
  assert.equal(requests, 1);

  await assert.rejects(() => generateWithCandidate({
    ...options,
    candidate: { ...candidate, id: "bad-model" },
    userPrompt: "different prompt",
    fetchImplementation: async () => new Response(JSON.stringify({ model: "wrong/model", choices: [{ message: { content: "answer" } }] }), { status: 200 }),
  }), /expected/);
  await assert.rejects(() => generateWithCandidate({ ...options, candidate: { ...candidate, id: "fallback-not-frozen", allowFallbacks: undefined as never } }), /disable OpenRouter fallbacks/);
  await fs.rm(directory, { recursive: true, force: true });
  console.log("Generator routing, model validation, usage capture, and cache reuse passed.");
}

main().catch((error) => { console.error(error); process.exit(1); });
