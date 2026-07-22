import assert from "node:assert/strict";

import { retrieveWithAgenticLoop, type EvidenceAssessment } from "../src/lib/rag/agentic-retrieval";
import type { RetrievalResult } from "../src/lib/rag/types";

const chunk = (id: string, score = .75): RetrievalResult => ({ id, title: id, section: "section", content: "evidence", sourceUrl: `https://example.test/${id}`, sourceId: "test", language: "Python", wordCount: 1, rank: 1, score });
const sufficient: EvidenceAssessment = { sufficient: true, reason: "Direct evidence covers the question.", missingAspects: [] };
const insufficient: EvidenceAssessment = { sufficient: false, reason: "A required aspect is missing.", missingAspects: ["required-aspect"] };

async function acceptsOnFirstAssessment() {
  let rewrites = 0;
  const result = await retrieveWithAgenticLoop("How does the feature work?", { retrieve: async () => [chunk("first")], assess: async () => sufficient, rewrite: async () => { rewrites += 1; return null; } });
  assert.equal(result.sufficient, true); assert.equal(result.attempts, 1); assert.equal(result.stopReason, "sufficient-evidence"); assert.equal(rewrites, 0);
}

async function rejectsThenRecovers() {
  let assessments = 0;
  const result = await retrieveWithAgenticLoop("How does the feature work?", {
    retrieve: async (query) => [chunk(query.includes("focused") ? "recovered" : "initial")],
    assess: async () => (++assessments === 1 ? insufficient : sufficient),
    rewrite: async () => ({ strategy: "missing-aspect", queries: ["focused feature evidence"], rationale: "Recover the missing aspect." }),
  });
  assert.equal(result.sufficient, true); assert.equal(result.attempts, 2); assert.equal(result.chunks[0].id, "recovered");
}

async function rejectsTwiceAndAbstains() {
  const result = await retrieveWithAgenticLoop("How does the feature work?", { retrieve: async () => [chunk("related")], assess: async () => insufficient, rewrite: async () => ({ strategy: "retry", queries: ["focused feature evidence"], rationale: "Try once." }) });
  assert.equal(result.sufficient, false); assert.equal(result.attempts, 2); assert.equal(result.stopReason, "maximum-attempts");
}

async function propagatesProviderFailure() {
  await assert.rejects(() => retrieveWithAgenticLoop("How does the feature work?", { retrieve: async () => [chunk("first")], assess: async () => { throw new Error("semantic provider unavailable"); }, rewrite: async () => null }), /semantic provider unavailable/);
}

async function main() {
  await acceptsOnFirstAssessment();
  await rejectsThenRecovers();
  await rejectsTwiceAndAbstains();
  await propagatesProviderFailure();
  console.log("Agentic semantic-gate tests passed: accept, retry recovery, final abstention, and provider failure.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
