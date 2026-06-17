import type { RetrievalResult } from "./types";

export const answerInstructions = [
  "You are a documentation interface, not a general-purpose chatbot.",
  "Answer only with information supported by the retrieved documentation chunks.",
  "If the retrieved context is insufficient, say that the answer cannot be fully determined from the provided documentation.",
  "Do not fabricate APIs, functions, behavior, versions, or links.",
  "Cite sources inline only with bracketed labels like [S1] or [S1, S2]. Do not cite sources as plain S1.",
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
1. Direct answer, grounded in the cited sources, with factual claims ending in bracketed citations like [S1].
2. Short note if the context is incomplete or ambiguous.
3. Do not include uncited claims or plain-text citation labels such as S1.`;
}
