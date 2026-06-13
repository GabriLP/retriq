import { ragConfig } from "./config";
import { getGeminiClient } from "./embeddings";
import { answerInstructions, buildGroundedPrompt } from "./prompt";
import type { RetrievalResult } from "./types";

export async function generateGroundedAnswer(question: string, chunks: RetrievalResult[]) {
  if (!chunks.length) {
    return "The retrieved documentation does not contain enough information to answer this question. Try ingesting more relevant documentation or lowering the retrieval threshold for exploration.";
  }

  const gemini = getGeminiClient();
  const prompt = buildGroundedPrompt(question, chunks);

  const response = await gemini.models.generateContent({
    model: ragConfig.model,
    contents: prompt,
    config: {
      maxOutputTokens: 900,
      systemInstruction: answerInstructions,
    },
  });

  return response.text?.trim() || "The model returned an empty response for the retrieved context.";
}
