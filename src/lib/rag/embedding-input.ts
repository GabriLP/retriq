export type EmbeddingTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "QUESTION_ANSWERING"
  | "CODE_RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY";

export function formatEmbeddingInput(
  text: string,
  model: string,
  taskType: EmbeddingTaskType,
  title?: string,
) {
  if (!usesPromptTaskInstructions(model)) return text;
  if (taskType === "RETRIEVAL_DOCUMENT") {
    return `title: ${title?.trim() || "none"} | text: ${text}`;
  }
  const task =
    taskType === "QUESTION_ANSWERING"
      ? "question answering"
      : taskType === "CODE_RETRIEVAL_QUERY"
        ? "code retrieval"
        : taskType === "SEMANTIC_SIMILARITY"
          ? "sentence similarity"
          : "search result";
  return `task: ${task} | query: ${text}`;
}

export function usesPromptTaskInstructions(model: string) {
  return model.replace(/^models\//, "").startsWith("gemini-embedding-2");
}
