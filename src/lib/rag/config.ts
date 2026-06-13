import path from "node:path";

const root = process.cwd();

export const ragConfig = {
  // Local JSON files keep chunks, vectors, and logs directly inspectable
  // without requiring database tooling during early development.
  chunksPath: path.join(root, "data", "chunks.json"),
  vectorStorePath: path.join(root, "data", "vector-store.json"),
  evaluationLogPath: path.join(root, "data", "evaluation-log.jsonl"),
  defaultTopK: Number(process.env.RETRIQ_TOP_K ?? 4),
  minScore: Number(process.env.RETRIQ_MIN_SCORE ?? 0.18),
  model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
};
