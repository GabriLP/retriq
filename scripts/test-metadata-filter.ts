import assert from "node:assert/strict";

import { filterChunksByQueryMetadata } from "../src/lib/rag/metadata-filter";
import type { DocumentationChunk } from "../src/lib/rag/types";

const chunks = [
  chunk("pg", "PostgreSQL / SQL", "18.4 snapshot"),
  chunk("java", "Java", "Java SE 26"),
  chunk("react", "React"),
  chunk("c", "C", "N1570 / C11 committee draft"),
  chunk("cpp", "C++", "N5046 / C++26 working draft"),
];

assert.equal(filterChunksByQueryMetadata("What changed in PostgreSQL 19?", chunks).decision.status, "unsupported-version");
assert.equal(filterChunksByQueryMetadata("Explain PostgreSQL 18 transactions", chunks).chunks[0]?.id, "pg");
assert.equal(filterChunksByQueryMetadata("What is final in Java SE 27?", chunks).decision.status, "unsupported-version");
assert.equal(filterChunksByQueryMetadata("How does Java overload resolution work?", chunks).chunks[0]?.id, "java");
assert.equal(filterChunksByQueryMetadata("How does React Native FlatList work?", chunks).decision.status, "unsupported-technology");
assert.equal(filterChunksByQueryMetadata("Why is state a snapshot?", chunks).chunks.length, chunks.length);
assert.equal(filterChunksByQueryMetadata("Which exceptions exist in C11 array conversion?", chunks).chunks[0]?.id, "c");
assert.equal(filterChunksByQueryMetadata("What parameter form makes a C++ move constructor?", chunks).decision.requestedTechnology, "cpp");
assert.equal(filterChunksByQueryMetadata("What parameter form makes a C++ move constructor?", chunks).chunks[0]?.id, "cpp");

console.log("Metadata filter tests passed.");

function chunk(id: string, language: string, version?: string): DocumentationChunk {
  return { id, title: id, section: id, content: id, sourceUrl: `https://example.com/${id}`, language, version, wordCount: 1 };
}
