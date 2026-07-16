import assert from "node:assert/strict";

import { embedProviderBatch } from "../src/lib/rag/embedding-providers";

async function main() {
  const originalFetch = globalThis.fetch;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalVoyageKey = process.env.VOYAGE_API_KEY;
  const requests: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.VOYAGE_API_KEY = "test-voyage-key";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const inputCount = Array.isArray(requests.at(-1)?.body.input) ? (requests.at(-1)?.body.input as unknown[]).length : 0;
    const data = inputCount === 1
      ? [{ index: 0, embedding: [0.1, 0.2] }]
      : [{ index: 1, embedding: [0.3, 0.4] }, { index: 0, embedding: [0.1, 0.2] }];
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const openAi = await embedProviderBatch(["one", "two"], {
      provider: "openai",
      model: "text-embedding-3-large",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 2,
    });
    assert.deepEqual(openAi, [[0.1, 0.2], [0.3, 0.4]], "OpenAI results must be restored to input order");
    assert.equal(requests[0].url, "https://api.openai.com/v1/embeddings");
    assert.equal(requests[0].authorization, "Bearer test-openai-key");
    assert.deepEqual(requests[0].body, {
      model: "text-embedding-3-large",
      input: ["one", "two"],
      encoding_format: "float",
      dimensions: 2,
    });

    const voyage = await embedProviderBatch(["one", "two"], {
      provider: "voyage",
      model: "voyage-code-3",
      taskType: "QUESTION_ANSWERING",
      outputDimensionality: 2,
    });
    assert.deepEqual(voyage, [[0.1, 0.2], [0.3, 0.4]], "Voyage results must be restored to input order");
    assert.equal(requests[1].url, "https://api.voyageai.com/v1/embeddings");
    assert.equal(requests[1].authorization, "Bearer test-voyage-key");
    assert.deepEqual(requests[1].body, {
      model: "voyage-code-3",
      input: ["one", "two"],
      input_type: "query",
      output_dtype: "float",
      output_dimension: 2,
    });

    await assert.rejects(
      embedProviderBatch(["one"], {
        provider: "openai",
        model: "text-embedding-3-large",
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 3,
      }),
      /returned dimension 2, expected 3/,
    );
    console.log("Embedding provider adapter tests passed.");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironmentVariable("OPENAI_API_KEY", originalOpenAiKey);
    restoreEnvironmentVariable("VOYAGE_API_KEY", originalVoyageKey);
  }
}

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
