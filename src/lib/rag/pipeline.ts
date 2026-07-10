import { performance } from "node:perf_hooks";

import { ragConfig } from "./config";
import { appendEvaluationLog } from "./evaluation-log";
import { generateGroundedAnswer } from "./generation";
import { judgeGroundedAnswer } from "./judge";
import { buildGroundedPrompt } from "./prompt";
import { retrieveRelevantChunks } from "./retrieval";
import type { Citation, QueryResponse } from "./types";

export async function answerQuestion(question: string, topK = ragConfig.defaultTopK): Promise<QueryResponse> {
  const startedAt = performance.now();

  const retrievalStartedAt = performance.now();
  const retrievedChunks = await retrieveRelevantChunks(question, topK);
  const retrievalMs = Math.round(performance.now() - retrievalStartedAt);

  const generationStartedAt = performance.now();
  const generatedAnswer = await generateGroundedAnswer(question, retrievedChunks);
  const generationMs = Math.round(performance.now() - generationStartedAt);

  const judgeStartedAt = performance.now();
  const judge = await judgeGroundedAnswer(question, generatedAnswer.answer, retrievedChunks);
  const judgeMs = Math.round(performance.now() - judgeStartedAt);

  const citations: Citation[] = retrievedChunks.map((chunk) => ({
    label: `S${chunk.rank}`,
    title: chunk.title,
    section: chunk.section,
    sourceUrl: chunk.sourceUrl,
  }));

  const response: QueryResponse = {
    question,
    answer: generatedAnswer.answer,
    answerStatus: generatedAnswer.answerStatus,
    citations,
    retrievedChunks,
    timings: {
      retrievalMs,
      generationMs,
      judgeMs,
      totalMs: Math.round(performance.now() - startedAt),
    },
    model: ragConfig.model,
    embeddingModel: ragConfig.embeddingModel,
    judge,
    // A short prompt preview is useful for debugging grounding behavior without
    // turning logs into a second full copy of the vector store.
    promptPreview: buildGroundedPrompt(question, retrievedChunks).slice(0, 4000),
  };

  if (ragConfig.evaluationLoggingEnabled) {
    await appendEvaluationLog(response);
  }

  return response;
}
