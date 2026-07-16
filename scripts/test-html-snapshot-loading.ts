import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadSources } from "../src/lib/rag/document-loaders";

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "retriq-html-snapshot-"));
  try {
    await Promise.all([
      fs.writeFile(path.join(directory, "one.html"), page("One", "https://example.test/docs/one", "Ownership rules")),
      fs.writeFile(path.join(directory, "two.html"), page("Two", "https://example.test/docs/two", "Borrowing rules")),
    ]);
    const documents = await loadSources([directory], {
      sourceMetadataByInput: {
        [directory]: {
          sourceId: "example-reference",
          sourceType: "html",
          language: "Example",
          title: "Example Reference",
        },
      },
    });

    assert.equal(documents.length, 2);
    assert.deepEqual(new Set(documents.map((document) => document.sourceId)), new Set(["example-reference"]));
    assert.deepEqual(new Set(documents.map((document) => document.language)), new Set(["Example"]));
    assert.deepEqual(
      new Set(documents.map((document) => document.sourceUrl)),
      new Set(["https://example.test/docs/one", "https://example.test/docs/two"]),
    );
    assert(documents.some((document) => document.content.includes("Ownership rules")));
    assert(documents.every((document) => !document.content.includes("Previous Next Index")));
    console.log("HTML snapshot loading tests passed.");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function page(title: string, canonical: string, content: string) {
  return `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${canonical}"></head><body><div role="navigation">Previous Next Index</div><div role="main"><h1>${title}</h1><h2>Rules</h2><p>${content}</p></div></body></html>`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
