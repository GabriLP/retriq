import assert from "node:assert/strict";

import { assessEvidenceCoverage, mergeRankings, retrieveWithAgenticLoop, type EvidenceAssessment, type QueryRewrite } from "../src/lib/rag/agentic-retrieval";
import type { RetrievalResult } from "../src/lib/rag/types";

async function main() {
  await stopsWhenInitialEvidenceIsSufficient();
  await rewritesOnceAndStopsOnRecoveredEvidence();
  await rejectsRepeatedPlans();
  await stopsWhenNoRewriteIsAvailable();
  await enforcesMaximumAttempts();
  await rejectsOversizedRewritePlans();
  testsCoverageAssessment();
  testsStableMerging();
  console.log("VALID agentic retrieval state machine, traces, evidence gates, and loop protections.");
}

async function stopsWhenInitialEvidenceIsSufficient() {
  let rewrites = 0;
  const result = await retrieveWithAgenticLoop("How does Rust ownership work?", {
    retrieve: async () => [chunk("rust-1", 1, 0.81, "Rust")],
    assess: async ({ chunks }) => assessEvidenceCoverage({ question: "Rust", chunks, requiredLanguages: ["Rust"] }),
    rewrite: async () => { rewrites += 1; return null; },
    now: clock(),
  });
  assert.equal(result.stopReason, "sufficient-evidence");
  assert.equal(result.attempts, 1);
  assert.equal(rewrites, 0);
  assert.deepEqual(result.trace.map((step) => step.action), ["retrieve", "assess", "stop"]);
}

async function rewritesOnceAndStopsOnRecoveredEvidence() {
  const retrievedQueries: string[] = [];
  const result = await retrieveWithAgenticLoop("Compare C and Rust memory management", {
    retrieve: async (query) => {
      retrievedQueries.push(query);
      if (query === "C memory management") return [chunk("c-1", 1, 0.76, "C")];
      if (query === "Rust memory management") return [chunk("rust-1", 1, 0.79, "Rust")];
      return [chunk("rust-weak", 1, 0.7, "Rust")];
    },
    assess: async ({ chunks }) => assessEvidenceCoverage({ question: "compare", chunks, requiredLanguages: ["C", "Rust"] }),
    rewrite: async () => ({ strategy: "decompose-by-language", queries: ["C memory management", "Rust memory management"], rationale: "Retrieve both sides." }),
    now: clock(),
  });
  assert.equal(result.stopReason, "sufficient-evidence");
  assert.equal(result.attempts, 2);
  assert.deepEqual(retrievedQueries, ["Compare C and Rust memory management", "C memory management", "Rust memory management"]);
  assert.deepEqual(result.chunks.map((item) => item.id), ["rust-1", "c-1"]);
  assert.deepEqual(result.trace.map((step) => step.action), ["retrieve", "assess", "rewrite", "retrieve", "assess", "stop"]);
}

async function rejectsRepeatedPlans() {
  const result = await retrieveWithAgenticLoop("Missing evidence question", dependencies({
    assessment: { sufficient: false, reason: "Missing evidence.", missingAspects: ["topic"] },
    rewrite: { strategy: "identity", queries: [" missing   evidence QUESTION "], rationale: "No useful change." },
  }));
  assert.equal(result.stopReason, "repeated-query-plan");
  assert.equal(result.attempts, 1);
  assert.equal(result.trace.at(-1)?.action, "stop");
}

async function stopsWhenNoRewriteIsAvailable() {
  const result = await retrieveWithAgenticLoop("Question without a rewrite", dependencies({
    assessment: { sufficient: false, reason: "No evidence.", missingAspects: ["topic"] },
    rewrite: null,
  }));
  assert.equal(result.stopReason, "no-rewrite-available");
  assert.equal(result.attempts, 1);
}

async function enforcesMaximumAttempts() {
  const result = await retrieveWithAgenticLoop("Question with weak evidence", dependencies({
    assessment: { sufficient: false, reason: "Still weak.", missingAspects: ["coverage"] },
    rewrite: { strategy: "broaden", queries: ["Broader documentation query"], rationale: "Try broader terms." },
  }), { maxAttempts: 2 });
  assert.equal(result.stopReason, "maximum-attempts");
  assert.equal(result.attempts, 2);
  assert.equal(result.trace.filter((step) => step.action === "retrieve").length, 2);
}

async function rejectsOversizedRewritePlans() {
  await assert.rejects(() => retrieveWithAgenticLoop("Question needing many searches", dependencies({
    assessment: { sufficient: false, reason: "Many gaps.", missingAspects: ["a", "b", "c"] },
    rewrite: { strategy: "too-many", queries: ["query one", "query two", "query three"], rationale: "Invalid expansion." },
  })), /maximum is 2/);
}

function testsCoverageAssessment() {
  const missing = assessEvidenceCoverage({ question: "Compare", chunks: [chunk("rust", 1, 0.8, "Rust")], requiredLanguages: ["Rust", "C"] });
  assert.equal(missing.sufficient, false);
  assert.deepEqual(missing.missingAspects, ["language:c"]);
  const weak = assessEvidenceCoverage({ question: "Rust", chunks: [chunk("weak", 1, 0.67, "Rust")] });
  assert.equal(weak.sufficient, false);
}

function testsStableMerging() {
  const merged = mergeRankings([
    [chunk("shared", 1, 0.72, "C"), chunk("c", 2, 0.7, "C")],
    [chunk("shared", 2, 0.75, "C"), chunk("rust", 1, 0.8, "Rust")],
  ], 3);
  assert.deepEqual(merged.map((item) => [item.id, item.rank, item.score]), [["rust", 1, 0.8], ["shared", 2, 0.75], ["c", 3, 0.7]]);
}

function dependencies(options: { assessment: EvidenceAssessment; rewrite: QueryRewrite | null }) {
  return {
    retrieve: async () => [] as RetrievalResult[],
    assess: async () => options.assessment,
    rewrite: async () => options.rewrite,
    now: clock(),
  };
}

function chunk(id: string, rank: number, score: number, language: string): RetrievalResult {
  return { id, rank, score, language, title: id, section: id, content: id, sourceUrl: `https://example.com/${id}`, wordCount: 10 };
}

function clock() { let value = 0; return () => { value += 5; return value; }; }

main().catch((error) => { console.error(error); process.exit(1); });
