import path from "node:path";

const root = process.cwd();
const evaluationLoggingSetting = process.env.RETRIQ_EVALUATION_LOG_ENABLED;
const judgeEnabledSetting = process.env.RETRIQ_LLM_JUDGE_ENABLED;

export const ragConfig = {
  // Local JSON files keep chunks, vectors, and logs directly inspectable
  // without requiring database tooling during early development.
  chunksPath: path.join(root, "data", "chunks.json"),
  vectorStorePath: path.join(root, "data", "vector-store.json"),
  evaluationLogPath: path.join(root, "data", "evaluation-log.jsonl"),
  // Local evaluation logs are enabled during development. Production defaults
  // to disabled because serverless filesystems do not provide durable storage.
  evaluationLoggingEnabled:
    evaluationLoggingSetting === undefined
      ? process.env.NODE_ENV !== "production"
      : evaluationLoggingSetting === "true",
  defaultTopK: Number(process.env.RETRIQ_TOP_K ?? 4),
  minScore: Number(process.env.RETRIQ_MIN_SCORE ?? 0.18),
  model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
  // Judging is opt-in: it adds latency and cost, and it must not silently
  // become part of the answer path in a research prototype.
  judgeEnabled: judgeEnabledSetting === "true",
  judgeModel: process.env.RETRIQ_LLM_JUDGE_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
};
