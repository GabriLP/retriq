import crypto from "node:crypto";

import type { DocumentationChunk, SourceDocument } from "./types";

const MIN_WORDS = 500;
const TARGET_WORDS = 850;
const OVERLAP_WORDS = 80;

export function normalizeWhitespace(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function countWords(value: string) {
  return normalizeWhitespace(value).split(/\s+/).filter(Boolean).length;
}

export function createChunksFromDocuments(documents: SourceDocument[]) {
  const chunks: DocumentationChunk[] = [];

  for (const document of documents) {
    const content = normalizeWhitespace(document.content);
    if (!content) continue;

    // Word-count chunking is intentionally simple and explainable. For the
    // thesis prototype, transparency matters more than advanced NLP splitting.
    const words = content.split(/\s+/);
    if (words.length <= TARGET_WORDS) {
      chunks.push(toChunk(document, content));
      continue;
    }

    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + TARGET_WORDS, words.length);
      const chunkContent = words.slice(start, end).join(" ");

      // Very small chunks often retrieve well by accident but provide weak
      // evidence. The minimum size keeps enough context for grounded answers.
      if (countWords(chunkContent) >= MIN_WORDS || start === 0) {
        chunks.push(toChunk(document, chunkContent, chunks.length + 1));
      }

      if (end === words.length) break;

      // Overlap reduces boundary loss: a concept split across two chunks still
      // has enough local context to be retrieved and cited coherently.
      start = Math.max(end - OVERLAP_WORDS, start + 1);
    }
  }

  return chunks;
}

function toChunk(document: SourceDocument, content: string, part?: number): DocumentationChunk {
  const idBase = `${document.sourceUrl}:${document.section}:${part ?? 1}:${content.slice(0, 160)}`;

  return {
    // Stable IDs make generated chunks easier to inspect across repeated runs.
    id: crypto.createHash("sha1").update(idBase).digest("hex").slice(0, 16),
    title: document.title,
    section: part ? `${document.section} (part ${part})` : document.section,
    content,
    sourceUrl: document.sourceUrl,
    wordCount: countWords(content),
  };
}
