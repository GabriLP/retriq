import assert from "node:assert/strict";

import { assessEvidenceCoverage, mergeAccumulatedEvidenceByLanguage, mergeRankings, retrieveWithAgenticLoop, type EvidenceAssessment, type QueryRewrite } from "../src/lib/rag/agentic-retrieval";
import { detectQueryMetadataConstraint } from "../src/lib/rag/metadata-filter";
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
  await preservesDefaultReplacementBehavior();
  await accumulatesWithLanguageQuotas();
  testsAccumulationDeduplicationAndFallback();
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

async function preservesDefaultReplacementBehavior() {
  let assessment = 0;
  const result = await retrieveWithAgenticLoop("Compare C and C++ memory", {
    retrieve: async (query) => query.startsWith("Compare") ? [chunk("c", 1, .72, "C")] : [chunk("cpp", 1, .76, "C++")],
    assess: async () => (++assessment === 1 ? { sufficient: false, reason: "Missing C++.", missingAspects: ["C++"] } : { sufficient: true, reason: "Current attempt accepted.", missingAspects: [] }),
    rewrite: async () => ({ strategy: "cpp", queries: ["C++ memory"], rationale: "Recover C++." }),
  });
  assert.deepEqual(result.chunks.map((item) => item.id), ["cpp"]);
}

async function accumulatesWithLanguageQuotas() {
  const result = await retrieveWithAgenticLoop("Compare C and C++ memory", {
    retrieve: async (query) => query.startsWith("Compare")
      ? [chunk("c-canonical", 1, .72, "C"), chunk("c-related", 2, .71, "C")]
      : [chunk("cpp-canonical", 1, .78, "C++"), chunk("cpp-related", 2, .77, "C++")],
    assess: async ({ chunks }) => chunks.some((item) => item.language === "C") && chunks.some((item) => item.language === "C++") ? { sufficient: true, reason: "Both sides.", missingAspects: [] } : { sufficient: false, reason: "Missing one side.", missingAspects: ["comparison-side"] },
    rewrite: async () => ({ strategy: "cpp", queries: ["C++ memory"], rationale: "Recover C++." }),
    accumulate: ({ question, previous, current, topK }) => mergeAccumulatedEvidenceByLanguage({ previous, current, requiredLanguages: detectQueryMetadataConstraint(question)?.databaseLanguages ?? [], topK }),
  }, { topK: 4 });
  assert.equal(result.sufficient, true);
  assert.equal(result.chunks.filter((item) => item.language === "C").length, 2);
  assert.equal(result.chunks.filter((item) => item.language === "C++").length, 2);
  assert.equal(result.trace.find((step) => step.attempt === 2 && step.action === "retrieve")?.newlyRetrieved?.length, 2);
}

function testsAccumulationDeduplicationAndFallback() {
  const deduplicated = mergeAccumulatedEvidenceByLanguage({ previous: [chunk("shared", 1, .7, "C"), chunk("c", 2, .69, "C")], current: [chunk("shared", 2, .75, "C"), chunk("cpp", 1, .74, "C++")], requiredLanguages: ["C", "C++"], topK: 4 });
  assert.equal(deduplicated.filter((item) => item.id === "shared").length, 1);
  assert.equal(deduplicated.find((item) => item.id === "shared")?.score, .75);
  const fallback = mergeAccumulatedEvidenceByLanguage({ previous: [chunk("old", 1, .7, "Rust")], current: [chunk("new", 1, .8, "Rust")], requiredLanguages: ["Rust"], topK: 1 });
  assert.deepEqual(fallback.map((item) => item.id), ["new"]);
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
