import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ThinkingLevel } from "@google/genai";

import type { EvidenceAssessment, QueryRewrite } from "./agentic-retrieval";
import { getGeminiClient } from "./gemini-client";
import type { RetrievalResult } from "./types";

export type AgenticPlannerCandidate = {
  id: string;
  model: string;
  reasoningEffort: "low";
  maxOutputTokens: number;
  inputPriceUsdPerMillionTokens: number;
  outputPriceUsdPerMillionTokens: number;
};

export type AgenticPlannerUsage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type AgenticPlannerResult = {
  rewrite: QueryRewrite;
  responseModel: string;
  responseId: string | null;
  finishReason: string | null;
  usage: AgenticPlannerUsage;
  latencyMs: number;
  cacheHit: boolean;
};

type PlannerResponse = {
  text?: string;
  modelVersion?: string;
  responseId?: string;
  candidates?: Array<{ finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
};

type PlannerRequest = {
  model: string;
  contents: string;
  config: {
    systemInstruction: string;
    temperature: number;
    maxOutputTokens: number;
    thinkingConfig: { thinkingLevel: ThinkingLevel };
    responseMimeType: "application/json";
    responseSchema: Record<string, unknown>;
  };
};

type Options = {
  candidate: AgenticPlannerCandidate;
  question: string;
  previousQueries: string[];
  assessment: EvidenceAssessment;
  chunks: RetrievalResult[];
  cacheDirectory?: string;
  allowProviderRequests?: boolean;
  generateContent?: (request: PlannerRequest) => Promise<PlannerResponse>;
};

export const agenticPlannerInstructions = `You rewrite documentation-retrieval queries. Do not answer the question.
Return at most two concise search queries that address the missing evidence.
Preserve every explicitly requested technology, version, API, and comparison side exactly; never substitute a related technology.
For a two-technology comparison, prefer one focused query per technology.
Do not introduce facts or requirements absent from the question and assessment.
Use the smallest rewrite that could recover the missing evidence.`;

export async function planAgenticRewrite(options: Options): Promise<AgenticPlannerResult> {
  validateCandidate(options.candidate);
  const cacheDirectory = path.resolve(options.cacheDirectory ?? "data/agentic-planner-cache");
  const request = buildRequest(options);
  const cacheKey = agenticPlannerCacheKey(options.candidate, request);
  const cachePath = path.join(cacheDirectory, `${cacheKey}.json`);
  const cached = await readCache(cachePath);
  if (cached) return { ...cached, cacheHit: true };
  if (options.allowProviderRequests === false) throw new Error(`Agentic planner cache miss ${cacheKey}; provider requests are disabled.`);
  const generate = options.generateContent ?? (async (value: PlannerRequest) => getGeminiClient().models.generateContent(value as Parameters<ReturnType<typeof getGeminiClient>["models"]["generateContent"]>[0]));
  const started = performance.now();
  const response = await generate(request);
  const rewrite = parseAgenticRewrite(response.text);
  const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  const reasoningTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
  const result: AgenticPlannerResult = {
    rewrite,
    responseModel: response.modelVersion ?? options.candidate.model,
    responseId: response.responseId ?? null,
    finishReason: response.candidates?.[0]?.finishReason ?? null,
    usage: {
      promptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens: response.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens + reasoningTokens,
      estimatedCostUsd: estimateCost(promptTokens, completionTokens + reasoningTokens, options.candidate),
    },
    latencyMs: Number((performance.now() - started).toFixed(2)),
    cacheHit: false,
  };
  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function buildAgenticPlannerPrompt(input: Pick<Options, "question" | "previousQueries" | "assessment" | "chunks">) {
  const evidence = input.chunks.slice(0, 4).map((chunk) => ({
    rank: chunk.rank,
    score: chunk.score,
    language: chunk.language ?? null,
    title: chunk.title,
    section: chunk.section,
  }));
  return `Original question:\n${input.question.trim()}\n\nPrevious retrieval queries:\n${input.previousQueries.map((query) => `- ${query}`).join("\n")}\n\nEvidence assessment:\n${input.assessment.reason}\nMissing aspects: ${input.assessment.missingAspects.join(", ") || "unspecified"}\n\nRetrieved evidence metadata:\n${JSON.stringify(evidence, null, 2)}`;
}

export function parseAgenticRewrite(text: string | undefined): QueryRewrite {
  let value: unknown;
  try { value = JSON.parse(text ?? ""); }
  catch { throw new Error("Agentic planner returned invalid JSON."); }
  if (!value || typeof value !== "object") throw new Error("Agentic planner output must be an object.");
  const output = value as Record<string, unknown>;
  if (!allowedStrategies.has(String(output.strategy))) throw new Error("Agentic planner returned an unsupported strategy.");
  if (!Array.isArray(output.queries) || output.queries.length < 1 || output.queries.length > 2) throw new Error("Agentic planner must return one or two queries.");
  const queries = [...new Set(output.queries.map((query) => typeof query === "string" ? query.trim().replace(/\s+/g, " ") : "").filter((query) => query.length >= 3))];
  if (!queries.length || queries.length !== output.queries.length) throw new Error("Agentic planner returned invalid or duplicate queries.");
  if (typeof output.rationale !== "string" || !output.rationale.trim()) throw new Error("Agentic planner rationale is required.");
  return { strategy: String(output.strategy), queries, rationale: output.rationale.trim().slice(0, 500) };
}

export function agenticPlannerCacheKey(candidate: AgenticPlannerCandidate, request: PlannerRequest) {
  return crypto.createHash("sha256").update(JSON.stringify({ schemaVersion: 1, candidate, request })).digest("hex");
}

const allowedStrategies = new Set(["decompose-by-technology", "focus-missing-aspect", "rephrase"]);

function buildRequest(options: Options): PlannerRequest {
  return {
    model: options.candidate.model,
    contents: buildAgenticPlannerPrompt(options),
    config: {
      systemInstruction: agenticPlannerInstructions,
      temperature: 0,
      maxOutputTokens: options.candidate.maxOutputTokens,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        additionalProperties: false,
        required: ["strategy", "queries", "rationale"],
        properties: {
          strategy: { type: "string", enum: [...allowedStrategies] },
          queries: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", minLength: 3 } },
          rationale: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
  };
}

function validateCandidate(candidate: AgenticPlannerCandidate) {
  if (candidate.model !== "gemini-3.5-flash" || candidate.reasoningEffort !== "low") throw new Error("Agentic planner v1 requires Gemini 3.5 Flash at low reasoning.");
  if (!Number.isInteger(candidate.maxOutputTokens) || candidate.maxOutputTokens < 64 || candidate.maxOutputTokens > 512) throw new Error("Agentic planner output budget must be between 64 and 512 tokens.");
}

async function readCache(cachePath: string): Promise<AgenticPlannerResult | null> {
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as AgenticPlannerResult;
    parseAgenticRewrite(JSON.stringify(cached.rewrite));
    if (!cached.responseModel || !cached.usage) throw new Error(`Invalid agentic planner cache entry ${cachePath}.`);
    return cached;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function estimateCost(inputTokens: number, outputTokens: number, candidate: AgenticPlannerCandidate) {
  return inputTokens / 1_000_000 * candidate.inputPriceUsdPerMillionTokens + outputTokens / 1_000_000 * candidate.outputPriceUsdPerMillionTokens;
}
