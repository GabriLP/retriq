import type { RetrievalResult } from "./types";

export const answerInstructions = [
  "You are a documentation interface, not a general-purpose chatbot.",
  "Answer only with information supported by the retrieved documentation chunks.",
  "If the retrieved context is insufficient, say that the answer cannot be fully determined from the provided documentation.",
  "Do not fabricate APIs, functions, behavior, versions, or links.",
  "Cite sources inline with labels like [S1] and keep the answer concise.",
  "Clearly separate confirmed documentation facts from uncertainty.",
].join("\n");

export function buildGroundedPrompt(question: string, chunks: RetrievalResult[]) {
  const context = chunks
    .map(
      (chunk) => `[S${chunk.rank}]
Title: ${chunk.title}
Section: ${chunk.section}
URL: ${chunk.sourceUrl}
Similarity: ${chunk.score}
Content:
${chunk.content}`,
    )
    .join("\n\n---\n\n");

  return `User question:
${question}

Retrieved documentation context:
${context || "No documentation chunks passed the retrieval threshold."}

Answer format:
1. Direct answer, grounded in the cited sources.
2. Short note if the context is incomplete or ambiguous.
3. Do not include uncited claims.`;
}
