import { performance } from "node:perf_hooks";

import type { RetrievalResult } from "./types";

export type AgenticStopReason =
  | "sufficient-evidence"
  | "maximum-attempts"
  | "no-rewrite-available"
  | "repeated-query-plan";

export type EvidenceAssessment = {
  sufficient: boolean;
  reason: string;
  missingAspects: string[];
};

export type QueryRewrite = {
  strategy: string;
  queries: string[];
  rationale: string;
};

export type AgenticTraceStep = {
  sequence: number;
  attempt: number;
  action: "retrieve" | "assess" | "rewrite" | "stop";
  durationMs: number;
  queries?: string[];
  retrieved?: Array<{ id: string; rank: number; score: number; language?: string }>;
  assessment?: EvidenceAssessment;
  rewrite?: QueryRewrite;
  stopReason?: AgenticStopReason;
};

export type AgenticRetrievalResult = {
  question: string;
  chunks: RetrievalResult[];
  sufficient: boolean;
  attempts: number;
  stopReason: AgenticStopReason;
  trace: AgenticTraceStep[];
};

export type AgenticRetrievalConfig = {
  topK: number;
  maxAttempts: number;
  maxQueriesPerAttempt: number;
};

export type AgenticRetrievalDependencies = {
  retrieve: (query: string, topK: number) => Promise<RetrievalResult[]>;
  merge?: (rankings: RetrievalResult[][], topK: number) => RetrievalResult[];
  assess: (input: {
    question: string;
    queries: string[];
    chunks: RetrievalResult[];
    attempt: number;
  }) => Promise<EvidenceAssessment>;
  rewrite: (input: {
    question: string;
    previousQueries: string[];
    chunks: RetrievalResult[];
    assessment: EvidenceAssessment;
    attempt: number;
  }) => Promise<QueryRewrite | null>;
  now?: () => number;
};

const defaultConfig: AgenticRetrievalConfig = {
  topK: 4,
  maxAttempts: 2,
  maxQueriesPerAttempt: 2,
};

export async function retrieveWithAgenticLoop(
  question: string,
  dependencies: AgenticRetrievalDependencies,
  overrides: Partial<AgenticRetrievalConfig> = {},
): Promise<AgenticRetrievalResult> {
  const normalizedQuestion = question.trim();
  if (normalizedQuestion.length < 3) throw new Error("Agentic retrieval requires a question of at least 3 characters.");
  const config = { ...defaultConfig, ...overrides };
  validateConfig(config);
  const now = dependencies.now ?? performance.now.bind(performance);
  const trace: AgenticTraceStep[] = [];
  const seenPlans = new Set<string>();
  let queries = [normalizedQuestion];
  let chunks: RetrievalResult[] = [];
  let assessment: EvidenceAssessment = { sufficient: false, reason: "Retrieval has not started.", missingAspects: [] };

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const planKey = queryPlanKey(queries);
    seenPlans.add(planKey);
    const retrievalStarted = now();
    const rankings = await Promise.all(queries.map((query) => dependencies.retrieve(query, config.topK)));
    chunks = (dependencies.merge ?? mergeRankings)(rankings, config.topK);
    trace.push({
      sequence: trace.length + 1,
      attempt,
      action: "retrieve",
      durationMs: elapsed(retrievalStarted, now()),
      queries: [...queries],
      retrieved: chunks.map((chunk) => ({ id: chunk.id, rank: chunk.rank, score: chunk.score, language: chunk.language })),
    });

    const assessmentStarted = now();
    assessment = validateAssessment(await dependencies.assess({ question: normalizedQuestion, queries: [...queries], chunks, attempt }));
    trace.push({ sequence: trace.length + 1, attempt, action: "assess", durationMs: elapsed(assessmentStarted, now()), assessment });
    if (assessment.sufficient) return finish("sufficient-evidence", true, attempt, normalizedQuestion, chunks, trace);
    if (attempt === config.maxAttempts) return finish("maximum-attempts", false, attempt, normalizedQuestion, chunks, trace);

    const rewriteStarted = now();
    const rewrite = await dependencies.rewrite({ question: normalizedQuestion, previousQueries: [...queries], chunks, assessment, attempt });
    const rewriteDurationMs = elapsed(rewriteStarted, now());
    if (!rewrite) {
      trace.push({ sequence: trace.length + 1, attempt, action: "rewrite", durationMs: rewriteDurationMs });
      return finish("no-rewrite-available", false, attempt, normalizedQuestion, chunks, trace);
    }
    const nextQueries = normalizeQueries(rewrite.queries, config.maxQueriesPerAttempt);
    const normalizedRewrite = { ...rewrite, queries: nextQueries };
    trace.push({ sequence: trace.length + 1, attempt, action: "rewrite", durationMs: rewriteDurationMs, rewrite: normalizedRewrite });
    if (seenPlans.has(queryPlanKey(nextQueries))) return finish("repeated-query-plan", false, attempt, normalizedQuestion, chunks, trace);
    queries = nextQueries;
  }

  return finish("maximum-attempts", false, config.maxAttempts, normalizedQuestion, chunks, trace);
}

export function assessEvidenceCoverage(input: {
  question: string;
  chunks: RetrievalResult[];
  minimumTopScore?: number;
  requiredLanguages?: string[];
}): EvidenceAssessment {
  const minimumTopScore = input.minimumTopScore ?? 0.68;
  if (!input.chunks.length) return { sufficient: false, reason: "No evidence passed the retrieval gate.", missingAspects: ["retrievable-evidence"] };
  if (input.chunks[0].score < minimumTopScore) return { sufficient: false, reason: `Top score ${input.chunks[0].score.toFixed(4)} is below ${minimumTopScore.toFixed(4)}.`, missingAspects: ["score-threshold"] };
  const requiredLanguages = [...new Set((input.requiredLanguages ?? []).map(normalizeLanguage).filter(Boolean))];
  const represented = new Set(input.chunks.map((chunk) => normalizeLanguage(chunk.language ?? "")).filter(Boolean));
  const missingLanguages = requiredLanguages.filter((language) => !represented.has(language));
  if (missingLanguages.length) return { sufficient: false, reason: `Evidence is missing required language coverage: ${missingLanguages.join(", ")}.`, missingAspects: missingLanguages.map((language) => `language:${language}`) };
  return { sufficient: true, reason: "Evidence passed the score and requested-coverage gates.", missingAspects: [] };
}

export function mergeRankings(rankings: RetrievalResult[][], topK: number) {
  const bestById = new Map<string, RetrievalResult>();
  for (const ranking of rankings) {
    for (const chunk of ranking) {
      const existing = bestById.get(chunk.id);
      if (!existing || chunk.score > existing.score || (chunk.score === existing.score && chunk.rank < existing.rank)) bestById.set(chunk.id, chunk);
    }
  }
  return [...bestById.values()]
    .sort((left, right) => right.score - left.score || left.rank - right.rank || left.id.localeCompare(right.id))
    .slice(0, topK)
    .map((chunk, index) => ({ ...chunk, rank: index + 1 }));
}

function finish(stopReason: AgenticStopReason, sufficient: boolean, attempts: number, question: string, chunks: RetrievalResult[], trace: AgenticTraceStep[]): AgenticRetrievalResult {
  trace.push({ sequence: trace.length + 1, attempt: attempts, action: "stop", durationMs: 0, stopReason });
  return { question, chunks, sufficient, attempts, stopReason, trace };
}

function validateConfig(config: AgenticRetrievalConfig) {
  if (!Number.isInteger(config.topK) || config.topK < 1) throw new Error("Agentic topK must be a positive integer.");
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 3) throw new Error("Agentic maxAttempts must be an integer from 1 to 3.");
  if (!Number.isInteger(config.maxQueriesPerAttempt) || config.maxQueriesPerAttempt < 1 || config.maxQueriesPerAttempt > 4) throw new Error("Agentic maxQueriesPerAttempt must be an integer from 1 to 4.");
}

function validateAssessment(value: EvidenceAssessment): EvidenceAssessment {
  if (typeof value.sufficient !== "boolean" || !value.reason.trim() || !Array.isArray(value.missingAspects) || value.missingAspects.some((item) => typeof item !== "string")) throw new Error("Invalid agentic evidence assessment.");
  return { sufficient: value.sufficient, reason: value.reason.trim(), missingAspects: [...value.missingAspects] };
}

function normalizeQueries(queries: string[], maximum: number) {
  const normalized = [...new Set(queries.map((query) => query.trim().replace(/\s+/g, " ")).filter((query) => query.length >= 3))];
  if (!normalized.length) throw new Error("Agentic rewrite returned no usable query.");
  if (normalized.length > maximum) throw new Error(`Agentic rewrite returned ${normalized.length} queries; maximum is ${maximum}.`);
  return normalized;
}

function queryPlanKey(queries: string[]) { return [...queries].map((query) => query.toLocaleLowerCase()).sort().join("\n"); }
function normalizeLanguage(value: string) { return value.trim().toLocaleLowerCase(); }
function elapsed(started: number, finished: number) { return Number(Math.max(0, finished - started).toFixed(2)); }
