import { ragConfig } from "./config";
import { getOpenAIClient } from "./embeddings";
import { answerInstructions, buildGroundedPrompt } from "./prompt";
import type { RetrievalResult } from "./types";

export async function generateGroundedAnswer(question: string, chunks: RetrievalResult[]) {
  if (!chunks.length) {
    return "The retrieved documentation does not contain enough information to answer this question. Try ingesting more relevant documentation or lowering the retrieval threshold for exploration.";
  }

  const openai = getOpenAIClient();
  const prompt = buildGroundedPrompt(question, chunks);

  const response = await openai.responses.create({
    model: ragConfig.model,
    instructions: answerInstructions,
    input: prompt,
    max_output_tokens: 900,
    store: false,
  });

  return response.output_text?.trim() || "The model returned an empty response for the retrieved context.";
}
