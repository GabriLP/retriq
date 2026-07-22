import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assessAgenticEvidence } from "../src/lib/rag/agentic-assessor";
import { buildAgenticPlannerPrompt, parseAgenticRewrite, planAgenticRewrite, type AgenticPlannerCandidate } from "../src/lib/rag/agentic-planner";
import type { EvidenceAssessment } from "../src/lib/rag/agentic-retrieval";
import type { RetrievalResult } from "../src/lib/rag/types";

const candidate: AgenticPlannerCandidate = {
  id: "gemini-3.5-flash-low-agentic-planner-v1",
  model: "gemini-3.5-flash",
  reasoningEffort: "low",
  maxOutputTokens: 256,
  inputPriceUsdPerMillionTokens: 1.5,
  outputPriceUsdPerMillionTokens: 9,
};

async function main() {
  testsAssessorTechnologyCoverage();
  testsPromptMinimizesEvidence();
  testsStrictOutputValidation();
  await testsProviderShapeCostAndCache();
  console.log("VALID agentic assessor and Gemini planner schema, cache, usage, and cost accounting.");
}

function testsAssessorTechnologyCoverage() {
  const partial = assessAgenticEvidence({ question: "Compare C and Rust memory management", chunks: [chunk("rust", 0.8, "Rust")] });
  assert.equal(partial.sufficient, false);
  assert.deepEqual(partial.missingAspects, ["language:c"]);
  const complete = assessAgenticEvidence({ question: "Compare C and Rust memory management", chunks: [chunk("rust", 0.8, "Rust"), chunk("c", 0.76, "C")] });
  assert.equal(complete.sufficient, true);
}

function testsPromptMinimizesEvidence() {
  const prompt = buildAgenticPlannerPrompt({ question: "Compare C and Rust", previousQueries: ["Compare C and Rust"], assessment: assessment(), chunks: [chunk("rust", 0.8, "Rust")] });
  assert.match(prompt, /language:c/);
  assert.match(prompt, /Rust/);
  assert.doesNotMatch(prompt, /full chunk body/);
}

function testsStrictOutputValidation() {
  assert.deepEqual(parseAgenticRewrite(JSON.stringify({ strategy: "decompose-by-technology", queries: ["C memory management", "Rust memory management"], rationale: "Cover both sides." })).queries, ["C memory management", "Rust memory management"]);
  assert.throws(() => parseAgenticRewrite(JSON.stringify({ strategy: "unknown", queries: ["query"], rationale: "x" })), /unsupported strategy/);
  assert.throws(() => parseAgenticRewrite(JSON.stringify({ strategy: "rephrase", queries: ["same query", "same query"], rationale: "x" })), /invalid or duplicate/);
}

async function testsProviderShapeCostAndCache() {
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "retriq-agentic-planner-"));
  let calls = 0;
  try {
    const options = {
      candidate,
      question: "Compare C and Rust memory management",
      previousQueries: ["Compare C and Rust memory management"],
      assessment: assessment(),
      chunks: [chunk("rust", 0.8, "Rust")],
      cacheDirectory,
      generateContent: async (request: Parameters<typeof planAgenticRewrite>[0] extends { generateContent?: infer T } ? T extends (...args: infer A) => unknown ? A[0] : never : never) => {
        calls += 1;
        assert.equal(request.model, "gemini-3.5-flash");
        assert.equal(request.config.responseMimeType, "application/json");
        assert.equal(request.config.temperature, 0);
        return { text: JSON.stringify({ strategy: "decompose-by-technology", queries: ["C memory management", "Rust memory management"], rationale: "Retrieve both sides." }), modelVersion: "gemini-3.5-flash", responseId: "test", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130 } };
      },
    };
    const first = await planAgenticRewrite(options);
    assert.equal(first.cacheHit, false);
    assert.equal(first.usage.estimatedCostUsd, 0.00042);
    const second = await planAgenticRewrite({ ...options, allowProviderRequests: false });
    assert.equal(second.cacheHit, true);
    assert.equal(calls, 1);
  } finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  }
}

function assessment(): EvidenceAssessment { return { sufficient: false, reason: "C evidence is missing.", missingAspects: ["language:c"] }; }
function chunk(id: string, score: number, language: string): RetrievalResult { return { id, rank: 1, score, language, title: id, section: id, content: "full chunk body", sourceUrl: `https://example.com/${id}`, wordCount: 3 }; }

main().catch((error) => { console.error(error); process.exit(1); });
