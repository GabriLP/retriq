import fs from "node:fs/promises";
import path from "node:path";

import { ragConfig } from "./config";
import type { EmbeddedChunk } from "./types";

export async function readVectorStore(filePath = ragConfig.vectorStorePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as {
    createdAt: string;
    embeddingModel: string;
    chunks: EmbeddedChunk[];
  };
}

export async function writeVectorStore(chunks: EmbeddedChunk[], filePath = ragConfig.vectorStorePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // A plain JSON store is enough for the controlled corpus and makes retrieval
  // artifacts directly auditable during the thesis evaluation.
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        embeddingModel: ragConfig.embeddingModel,
        chunks,
      },
      null,
      2,
    ),
  );
}

export function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

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
