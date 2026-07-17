import assert from "node:assert/strict";

import { mapRetrievalRow, toPgVector } from "../src/lib/rag/postgres-vector-store";

assert.equal(toPgVector([0.1, -0.2], 2), "[0.1,-0.2]");
assert.throws(() => toPgVector([0.1], 2), /2-dimension/);
assert.throws(() => toPgVector([Number.NaN, 0], 2), /non-finite/);

const mapped = mapRetrievalRow({
  chunk_id: "java-1", title: "JLS", section: "Classes", content: "A class declaration...",
  source_url: "https://example.test/jls.pdf", source_id: "jls", source_type: "pdf", language: "Java",
  version: "Java SE 26", family: null, document_role: "specification", authority: "primary",
  stability: "versioned", publisher: "Oracle", page_start: 12, page_end: 13, word_count: 250,
  score: "0.87654",
}, 1);
assert.deepEqual(mapped, {
  id: "java-1", title: "JLS", section: "Classes", content: "A class declaration...",
  sourceUrl: "https://example.test/jls.pdf", sourceId: "jls", sourceType: "pdf", language: "Java",
  version: "Java SE 26", documentRole: "specification", authority: "primary", stability: "versioned",
  publisher: "Oracle", pageStart: 12, pageEnd: 13, wordCount: 250, rank: 1, score: 0.8765,
});
console.log("PostgreSQL vector formatting and retrieval mapping passed.");
