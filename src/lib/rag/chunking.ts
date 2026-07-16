import crypto from "node:crypto";

import type { DocumentationChunk, SourceDocument } from "./types";

export type ChunkingConfig = {
  strategy: "word-window";
  minWords: number;
  targetWords: number;
  overlapWords: number;
};

export const defaultChunkingConfig: ChunkingConfig = {
  strategy: "word-window",
  minWords: 500,
  targetWords: 850,
  overlapWords: 80,
};

export function normalizeWhitespace(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function countWords(value: string) {
  return normalizeWhitespace(value).split(/\s+/).filter(Boolean).length;
}

export function createChunksFromDocuments(
  documents: SourceDocument[],
  config: ChunkingConfig = defaultChunkingConfig,
) {
  validateChunkingConfig(config);
  const chunks: DocumentationChunk[] = [];

  for (const document of documents) {
    const content = normalizeWhitespace(document.content);
    if (!content) continue;

    // Word-count chunking keeps the preprocessing step deterministic and easy
    // to inspect before introducing more advanced NLP-based segmentation.
    const blocks = splitIntoBlocks(content);
    const totalWords = countWords(content);
    if (totalWords <= config.targetWords) {
      chunks.push(toChunk(document, content));
      continue;
    }

    let blockIndex = 0;
    let part = 1;
    while (blockIndex < blocks.length) {
      const chunkBlocks: string[] = [];
      let chunkWords = 0;
      let nextIndex = blockIndex;

      while (nextIndex < blocks.length && (chunkWords < config.targetWords || !chunkBlocks.length)) {
        const block = blocks[nextIndex];
        chunkBlocks.push(block);
        chunkWords += countWords(block);
        nextIndex += 1;
      }

      const chunkContent = normalizeWhitespace(chunkBlocks.join("\n\n"));

      // Very small chunks often retrieve well by accident but provide weak
      // evidence. The minimum size keeps enough context for grounded answers.
      if (countWords(chunkContent) >= config.minWords || blockIndex === 0) {
        // Part numbers are local to the source section so citation labels remain
        // meaningful regardless of the manifest order or total corpus size.
        chunks.push(toChunk(document, chunkContent, part));
        part += 1;
      }

      if (nextIndex === blocks.length) break;

      // Overlap reduces boundary loss: a concept split across two chunks still
      // has enough local context to be retrieved and cited coherently.
      blockIndex = findOverlapStart(blocks, blockIndex, nextIndex, config.overlapWords);
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

function findOverlapStart(blocks: string[], currentIndex: number, nextIndex: number, overlapTarget: number) {
  let overlapWords = 0;
  let overlapIndex = nextIndex;

  while (overlapIndex > 0 && overlapWords < overlapTarget) {
    overlapIndex -= 1;
    overlapWords += countWords(blocks[overlapIndex]);
  }

  return Math.max(overlapIndex, currentIndex + 1);
}

function validateChunkingConfig(config: ChunkingConfig) {
  if (config.strategy !== "word-window") throw new Error(`Unsupported chunking strategy: ${config.strategy}`);
  if (!Number.isInteger(config.minWords) || config.minWords < 1) throw new Error("chunking.minWords must be positive.");
  if (!Number.isInteger(config.targetWords) || config.targetWords < config.minWords) {
    throw new Error("chunking.targetWords must be an integer greater than or equal to minWords.");
  }
  if (!Number.isInteger(config.overlapWords) || config.overlapWords < 0 || config.overlapWords >= config.targetWords) {
    throw new Error("chunking.overlapWords must be between 0 and targetWords - 1.");
  }
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
    sourceId: document.sourceId,
    sourceType: document.sourceType,
    language: document.language,
    version: document.version,
    family: document.family,
    documentRole: document.documentRole,
    authority: document.authority,
    stability: document.stability,
    publisher: document.publisher,
    pageStart: document.pageStart,
    pageEnd: document.pageEnd,
    wordCount: countWords(content),
  };
}
