import assert from "node:assert/strict";

import { Bm25Index, reciprocalRankFusion, tokenize } from "../src/lib/rag/retrieval-strategies";
import type { DocumentationChunk } from "../src/lib/rag/types";

const chunks: DocumentationChunk[] = [
  chunk("java", "Java ArrayList resizing and capacity"),
  chunk("react", "React state rendering and effects"),
  chunk("postgres", "PostgreSQL transaction isolation levels"),
];

assert.deepEqual(tokenize("System.Linq IQueryable<T>"), ["system.linq", "iqueryable", "t"]);

const index = new Bm25Index(chunks);
assert.equal(index.search("transaction isolation")[0]?.id, "postgres");
assert.equal(index.search("missing vocabulary").length, 0);

const fused = reciprocalRankFusion(
  [
    [{ ...chunks[0], score: 0.9 }, { ...chunks[1], score: 0.8 }],
    [{ ...chunks[1], score: 12 }, { ...chunks[0], score: 8 }],
  ],
  { rankConstant: 60 },
);
assert.equal(fused.length, 2);
assert.equal(fused[0].id, "java");
assert.equal(fused[0].score, fused[1].score);

console.log("Retrieval strategy tests passed.");

function chunk(id: string, content: string): DocumentationChunk {
  return {
    id,
    title: id,
    section: id,
    content,
    sourceUrl: `https://example.com/${id}`,
    wordCount: content.split(/\s+/).length,
  };
}
