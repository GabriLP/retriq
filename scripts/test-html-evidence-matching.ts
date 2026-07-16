import assert from "node:assert/strict";

import { matchesEvidence } from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk } from "../src/lib/rag/types";

const chunk = {
  id: "chunk-1",
  sourceId: "python-tutorial",
  sourceUrl: "https://docs.python.org/3/tutorial/controlflow.html",
  title: "The Python Tutorial",
  section: "Default Argument Values",
  content: "Defaults are evaluated once.",
  wordCount: 4,
} as DocumentationChunk;

assert(matchesEvidence(chunk, { sourceId: "python-tutorial" }));
assert(matchesEvidence(chunk, { sourceUrl: chunk.sourceUrl }));
assert(matchesEvidence(chunk, { sourceId: "python-tutorial", sourceUrl: chunk.sourceUrl }));
assert(!matchesEvidence(chunk, { sourceId: "python-tutorial", sourceUrl: "https://docs.python.org/3/tutorial/classes.html" }));
assert(!matchesEvidence(chunk, { sourceId: "python-language-reference", sourceUrl: chunk.sourceUrl }));

console.log("HTML evidence matching tests passed.");
