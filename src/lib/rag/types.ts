// A chunk is the smallest inspectable evidence unit in the study: it keeps
// enough metadata to show users where an answer came from, not just the text.
export type DocumentationChunk = {
  id: string;
  title: string;
  section: string;
  content: string;
  sourceUrl: string;
  sourceId?: string;
  sourceType?: SourceType;
  language?: string;
  pageStart?: number;
  pageEnd?: number;
  wordCount: number;
};

export type EmbeddedChunk = DocumentationChunk & {
  embedding: number[];
};

// Corpus-level metadata makes the retrieval scope explicit without exposing
// embedding vectors or duplicating the indexed documentation in the client.
export type CorpusSummary = {
  sourceCount: number;
  chunkCount: number;
  wordCount: number;
  indexedAt: string;
};

// Retrieval results preserve ranking and score so the UI can expose why a
// specific documentation section was used by the model.
export type RetrievalResult = DocumentationChunk & {
  rank: number;
  score: number;
};

export type QueryRequest = {
  question: string;
  topK?: number;
};

export type Citation = {
  label: string;
  title: string;
  section: string;
  sourceUrl: string;
  pageStart?: number;
  pageEnd?: number;
};

export type AnswerStatus = "grounded" | "insufficient_context";

// Query responses keep both generated text and raw retrieval evidence. This
// separation is central to evaluating trust and hallucination risk.
export type QueryResponse = {
  question: string;
  answer: string;
  answerStatus: AnswerStatus;
  citations: Citation[];
  retrievedChunks: RetrievalResult[];
  timings: {
    retrievalMs: number;
    generationMs: number;
    judgeMs: number;
    totalMs: number;
  };
  model: string;
  embeddingModel: string;
  judge: JudgeAssessment;
  promptPreview: string;
};

// The evaluation log stores each query as a later analyzable observation for
// task-completion time, retrieval quality, and answer-grounding review.
export type EvaluationLogEntry = QueryResponse & {
  id: string;
  createdAt: string;
};

export type SourceDocument = {
  title: string;
  section: string;
  content: string;
  sourceUrl: string;
  sourceId?: string;
  sourceType?: SourceType;
  language?: string;
  pageStart?: number;
  pageEnd?: number;
};

export type SourceType = "html" | "markdown" | "pdf";

export type JudgeVerdict = "pass" | "needs_review" | "fail" | "disabled" | "unavailable";

// The judge is deliberately a separate measurement layer. It never changes the
// answer returned to the user, because an LLM judgement is an experimental
// signal rather than an authoritative correctness guarantee.
export type JudgeAssessment = {
  enabled: boolean;
  verdict: JudgeVerdict;
  groundedness: number | null;
  citationCorrectness: number | null;
  completeness: number | null;
  rationale: string;
  unsupportedClaims: string[];
  missingInformation: string[];
  model?: string;
};
