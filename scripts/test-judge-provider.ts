import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildJudgeResponseSchema, judgeWithOpenRouter, validateJudgeOutput, type JudgeCandidate } from "../src/lib/evaluation/judge-provider";

const candidate: JudgeCandidate = {
  id: "test-judge",
  model: "openai/gpt-5.4-nano",
  expectedResponseModel: "openai/gpt-5.4-nano",
  expectedResponseProvider: "OpenAI",
  providerOrder: ["openai"],
  reasoningEffort: "medium",
  inputPriceUsdPerMillionTokens: 0.2,
  outputPriceUsdPerMillionTokens: 1.25,
};
const output = {
  answerability: "answerable" as const,
  scores: { groundedness: 4, keyFactCoverage: 4, citationCorrectness: 4, citationCompleteness: 4, directness: 2, correctAbstention: null },
  flags: { criticalUnsupportedClaim: false, contradictsEvidence: false, invalidCitationLabel: false, generatorFailure: false },
  rationale: "All claims are supported by S1.",
  unsupportedClaims: [],
  missingKeyFacts: [],
  citationIssues: [],
};
validateJudgeOutput(output);
assert.throws(() => validateJudgeOutput({ ...output, scores: { ...output.scores, groundedness: 5 } }));
const baseSchema = { properties: { answerability: {}, scores: { properties: Object.fromEntries(Object.keys(output.scores).map((key) => [key, {}])) } } };
const answerableSchema = buildJudgeResponseSchema(baseSchema, "answerable") as typeof baseSchema;
assert.deepEqual(answerableSchema.properties.answerability, { type: "string", const: "answerable" });
assert.deepEqual(answerableSchema.properties.scores.properties.correctAbstention, { type: "null" });
const unanswerableSchema = buildJudgeResponseSchema(baseSchema, "unanswerable") as typeof baseSchema;
assert.deepEqual(unanswerableSchema.properties.scores.properties.groundedness, { type: "null" });

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "retriq-judge-test-"));
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requests = 0;
  try {
  const options = {
    candidate,
    systemInstruction: "judge",
    userPrompt: "task",
    schema: { type: "object" },
    maxOutputTokens: 100,
    cacheDirectory: directory,
    fetchImplementation: (async (_input: string | URL | Request, init?: RequestInit) => {
      requests += 1;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.provider, { order: ["openai"], allow_fallbacks: false });
      assert.equal(body.reasoning.effort, "medium");
      assert.equal(body.response_format.type, "json_schema");
      return new Response(JSON.stringify({
        id: "response-1",
        model: "openai/gpt-5.4-nano",
        provider: "OpenAI",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.000045 },
      }), { status: 200 });
    }) as typeof fetch,
  };
  const first = await judgeWithOpenRouter(options);
  const second = await judgeWithOpenRouter({ ...options, allowProviderRequests: false });
  assert.equal(requests, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.output.scores.groundedness, 4);
    console.log("VALID judge provider pinning, structured output, and cache behavior.");
  } finally {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
