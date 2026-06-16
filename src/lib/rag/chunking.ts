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

    // Word-count chunking keeps the preprocessing step deterministic and easy
    // to inspect before introducing more advanced NLP-based segmentation.
    const blocks = splitIntoBlocks(content);
    const totalWords = countWords(content);
    if (totalWords <= TARGET_WORDS) {
      chunks.push(toChunk(document, content));
      continue;
    }

    let blockIndex = 0;
    while (blockIndex < blocks.length) {
      const chunkBlocks: string[] = [];
      let chunkWords = 0;
      let nextIndex = blockIndex;

      while (nextIndex < blocks.length && (chunkWords < TARGET_WORDS || !chunkBlocks.length)) {
        const block = blocks[nextIndex];
        chunkBlocks.push(block);
        chunkWords += countWords(block);
        nextIndex += 1;
      }

      const chunkContent = normalizeWhitespace(chunkBlocks.join("\n\n"));

      // Very small chunks often retrieve well by accident but provide weak
      // evidence. The minimum size keeps enough context for grounded answers.
      if (countWords(chunkContent) >= MIN_WORDS || blockIndex === 0) {
        chunks.push(toChunk(document, chunkContent, chunks.length + 1));
      }

      if (nextIndex === blocks.length) break;

      // Overlap reduces boundary loss: a concept split across two chunks still
      // has enough local context to be retrieved and cited coherently.
      blockIndex = findOverlapStart(blocks, blockIndex, nextIndex);
    }
  }

  return chunks;
}

function splitIntoBlocks(content: string) {
  return normalizeWhitespace(content)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function findOverlapStart(blocks: string[], currentIndex: number, nextIndex: number) {
  let overlapWords = 0;
  let overlapIndex = nextIndex;

  while (overlapIndex > 0 && overlapWords < OVERLAP_WORDS) {
    overlapIndex -= 1;
    overlapWords += countWords(blocks[overlapIndex]);
  }

  return Math.max(overlapIndex, currentIndex + 1);
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
