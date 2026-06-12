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
  model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
};
