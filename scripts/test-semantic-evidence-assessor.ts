import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assessEvidenceSemantically, buildSemanticAssessorPrompt, validateSemanticAssessment, type SemanticAssessorCandidate } from "../src/lib/rag/semantic-evidence-assessor";
import type { RetrievalResult } from "../src/lib/rag/types";

const candidate: SemanticAssessorCandidate = {
  id: "test-gpt-mini-semantic-assessor", model: "openai/gpt-5.4-mini", expectedResponseModel: "openai/gpt-5.4-mini",
  expectedResponseProvider: "OpenAI", providerOrder: ["openai"], reasoningEffort: "medium", maxOutputTokens: 1000,
  inputPriceUsdPerMillionTokens: .75, outputPriceUsdPerMillionTokens: 4.5,
};

async function main() {
  assert.match(buildSemanticAssessorPrompt("Does this answer it?", [chunk()]), /Direct evidence about the requested API/);
  assert.throws(() => validateSemanticAssessment({ sufficient: true, reason: "", supportedAspects: [], missingAspects: [] }), /invalid sufficiency/);
  const empty = await assessEvidenceSemantically({ candidate, question: "Question", chunks: [], allowProviderRequests: false });
  assert.equal(empty.assessment.sufficient, false);
  assert.equal(empty.providerInvoked, false);
  await testProviderRoutingSchemaUsageAndCache();
  console.log("VALID semantic evidence assessor prompt, strict schema, deterministic empty gate, routing, usage, and cache.");
}

async function testProviderRoutingSchemaUsageAndCache() {
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "retriq-semantic-assessor-"));
  let calls = 0;
  try {
    const options = {
      candidate, question: "Does the evidence explain the API?", chunks: [chunk()], cacheDirectory,
      fetchImplementation: async (_input: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body.model, candidate.model);
        assert.deepEqual(body.provider, { order: ["openai"], allow_fallbacks: false });
        assert.equal((body.response_format as { type: string }).type, "json_schema");
        return new Response(JSON.stringify({
          id: "semantic-test", model: candidate.model, provider: "OpenAI",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ sufficient: true, reason: "The excerpt directly explains the requested API.", supportedAspects: ["requested API"], missingAspects: [] }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: .000255, completion_tokens_details: { reasoning_tokens: 20 } },
        }), { status: 200 });
      },
    };
    const first = await assessEvidenceSemantically(options);
    assert.equal(first.assessment.sufficient, true);
    assert.equal(first.cacheHit, false);
    assert.equal(first.usage.costUsd, .000255);
    const second = await assessEvidenceSemantically({ ...options, allowProviderRequests: false });
    assert.equal(second.cacheHit, true);
    assert.equal(calls, 1);
  } finally { await fs.rm(cacheDirectory, { recursive: true, force: true }); }
}

function chunk(): RetrievalResult { return { id: "chunk", rank: 1, score: .8, title: "API reference", section: "Direct evidence", content: "Direct evidence about the requested API.", sourceUrl: "https://example.com", language: "TypeScript", wordCount: 6 }; }

main().catch((error) => { console.error(error); process.exit(1); });
