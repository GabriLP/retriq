import { ragConfig } from "./config";
import { getGeminiClient } from "./embeddings";
import { answerInstructions, buildGroundedPrompt } from "./prompt";
import type { AnswerStatus, RetrievalResult } from "./types";

export type GeneratedAnswer = {
  answer: string;
  answerStatus: AnswerStatus;
};

export async function generateGroundedAnswer(question: string, chunks: RetrievalResult[]): Promise<GeneratedAnswer> {
  if (!chunks.length) {
    return {
      answer:
        "The retrieved documentation does not contain enough information to answer this question. Try ingesting more relevant documentation or lowering the retrieval threshold for exploration.",
      answerStatus: "insufficient_context" satisfies AnswerStatus,
    };
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

  const answer = response.text?.trim() || "The model returned an empty response for the retrieved context.";

  return {
    answer,
    answerStatus: classifyAnswerStatus(answer),
  };
}

function classifyAnswerStatus(answer: string): AnswerStatus {
  const normalized = answer.toLowerCase();
  if (
    normalized.includes("cannot be fully determined") ||
    normalized.includes("cannot be determined") ||
    normalized.includes("does not contain enough information") ||
    normalized.includes("insufficient")
  ) {
    return "insufficient_context";
  }

  return "grounded";
}
