import fs from "node:fs/promises";
import path from "node:path";

import { ragConfig } from "./config";
import type { CorpusSummary, EmbeddedChunk } from "./types";

export async function readVectorStore(filePath = ragConfig.vectorStorePath) {
  const raw = await fs.readFile(filePath, "utf8");
  // The vector store is deliberately typed at the boundary so retrieval code can
  // stay explicit about which metadata is available for citations and analysis.
  return JSON.parse(raw) as {
    createdAt: string;
    embeddingModel: string;
    chunks: EmbeddedChunk[];
  };
}

export async function writeVectorStore(chunks: EmbeddedChunk[], filePath = ragConfig.vectorStorePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // A plain JSON store is enough for a controlled corpus and keeps retrieval
  // artifacts easy to inspect while the dataset is still small.
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        // Persisting the embedding model is important because vector spaces are
        // model-specific; scores from different embedding models are not equal.
        embeddingModel: ragConfig.embeddingModel,
        chunks,
      },
      null,
      2,
    ),
  );
}

export async function readCorpusSummary(filePath = ragConfig.vectorStorePath): Promise<CorpusSummary> {
  const store = await readVectorStore(filePath);

  // Sources are counted by canonical URL because one document can produce
  // several overlapping chunks while remaining a single navigable source.
  return {
    sourceCount: new Set(store.chunks.map((chunk) => chunk.sourceUrl)).size,
    chunkCount: store.chunks.length,
    wordCount: store.chunks.reduce((total, chunk) => total + chunk.wordCount, 0),
    indexedAt: store.createdAt,
  };
}

export function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  // The loop computes dot product and vector magnitudes together to keep the
  // retrieval baseline easy to inspect without adding a math dependency.
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (!leftMagnitude || !rightMagnitude) return 0;

  // Cosine similarity is a transparent baseline: higher values indicate closer
  // semantic direction between the query vector and a documentation chunk.
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
