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

export type AgenticPlannerRecoveryAttempt = {
  kind: "initial" | "format-repair" | "empty-response-retry";
  responseText: string | null;
  responseModel: string;
  responseId: string | null;
  finishReason: string | null;
  usage: AgenticPlannerUsage;
  latencyMs: number;
  parseError: string | null;
};

export type AgenticPlannerRecoveryResult = AgenticPlannerResult & {
  recovery: {
    policy: "one-controlled-recovery";
    used: boolean;
    succeeded: boolean;
    attempts: AgenticPlannerRecoveryAttempt[];
  };
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

export async function planAgenticRewriteWithRecovery(options: Options): Promise<AgenticPlannerRecoveryResult> {
  validateCandidate(options.candidate);
  const cacheDirectory = path.resolve(options.cacheDirectory ?? "data/agentic-planner-cache");
  const request = buildRequest(options);
  const cacheKey = crypto.createHash("sha256").update(JSON.stringify({ schemaVersion: 2, candidate: options.candidate, request, recoveryPolicy: "one-controlled-recovery" })).digest("hex");
  const cachePath = path.join(cacheDirectory, `${cacheKey}.json`);
  const cached = await readRecoveryCache(cachePath);
  if (cached) return { ...cached, cacheHit: true };
  if (options.allowProviderRequests === false) throw new Error(`Agentic planner recovery cache miss ${cacheKey}; provider requests are disabled.`);
  const generate = options.generateContent ?? (async (value: PlannerRequest) => getGeminiClient().models.generateContent(value as Parameters<ReturnType<typeof getGeminiClient>["models"]["generateContent"]>[0]));
  const attempts: AgenticPlannerRecoveryAttempt[] = [];
  const initial = await executeAuditedAttempt("initial", request, options.candidate, generate);
  attempts.push(initial.audit);
  if (initial.rewrite) {
    const result = recoveryResult(initial.rewrite, initial.response, attempts, false, options.candidate);
    await persistRecovery(cacheDirectory, cachePath, result);
    return result;
  }

  const recoveryKind = initial.response.text?.trim() ? "format-repair" : "empty-response-retry";
  const recoveryRequest = recoveryKind === "format-repair" ? buildFormatRepairRequest(request, initial.response.text!) : request;
  const recovered = await executeAuditedAttempt(recoveryKind, recoveryRequest, options.candidate, generate);
  attempts.push(recovered.audit);
  if (!recovered.rewrite) {
    await fs.mkdir(cacheDirectory, { recursive: true });
    await fs.writeFile(path.join(cacheDirectory, `${cacheKey}.failure.json`), `${JSON.stringify({ schemaVersion: 1, cacheKey, recoveryPolicy: "one-controlled-recovery", attempts }, null, 2)}\n`);
    throw new Error(`Agentic planner recovery failed after ${attempts.length} structured-output attempts.`);
  }
  const result = recoveryResult(recovered.rewrite, recovered.response, attempts, true, options.candidate);
  await persistRecovery(cacheDirectory, cachePath, result);
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

async function executeAuditedAttempt(kind: AgenticPlannerRecoveryAttempt["kind"], request: PlannerRequest, candidate: AgenticPlannerCandidate, generate: (request: PlannerRequest) => Promise<PlannerResponse>) {
  const started = performance.now();
  const response = await generate(request);
  const latencyMs = Number((performance.now() - started).toFixed(2));
  let rewrite: QueryRewrite | null = null;
  let parseError: string | null = null;
  try { rewrite = parseAgenticRewrite(response.text); }
  catch (error) { parseError = error instanceof Error ? error.message : "Unknown structured-output parsing error."; }
  const audit: AgenticPlannerRecoveryAttempt = {
    kind,
    responseText: response.text ?? null,
    responseModel: response.modelVersion ?? candidate.model,
    responseId: response.responseId ?? null,
    finishReason: response.candidates?.[0]?.finishReason ?? null,
    usage: usageFor(response, candidate),
    latencyMs,
    parseError,
  };
  return { response, rewrite, audit };
}

function buildFormatRepairRequest(original: PlannerRequest, invalidText: string): PlannerRequest {
  return {
    ...original,
    contents: `Convert the following malformed planner output to the required JSON schema. Preserve its query meaning; do not answer the original question and do not add new requirements.\n\nMalformed output:\n${invalidText}`,
    config: {
      ...original.config,
      systemInstruction: "Repair formatting only. Return exactly one valid JSON object matching the supplied schema, with no markdown fences or surrounding prose.",
    },
  };
}

function usageFor(response: PlannerResponse, candidate: AgenticPlannerCandidate): AgenticPlannerUsage {
  const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  const reasoningTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens: response.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens + reasoningTokens,
    estimatedCostUsd: estimateCost(promptTokens, completionTokens + reasoningTokens, candidate),
  };
}

function recoveryResult(rewrite: QueryRewrite, response: PlannerResponse, attempts: AgenticPlannerRecoveryAttempt[], recovered: boolean, candidate: AgenticPlannerCandidate): AgenticPlannerRecoveryResult {
  const usage = attempts.reduce((total, attempt) => ({
    promptTokens: total.promptTokens + attempt.usage.promptTokens,
    completionTokens: total.completionTokens + attempt.usage.completionTokens,
    reasoningTokens: total.reasoningTokens + attempt.usage.reasoningTokens,
    totalTokens: total.totalTokens + attempt.usage.totalTokens,
    estimatedCostUsd: total.estimatedCostUsd + attempt.usage.estimatedCostUsd,
  }), { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
  return {
    rewrite,
    responseModel: response.modelVersion ?? candidate.model,
    responseId: response.responseId ?? null,
    finishReason: response.candidates?.[0]?.finishReason ?? null,
    usage,
    latencyMs: Number(attempts.reduce((total, attempt) => total + attempt.latencyMs, 0).toFixed(2)),
    cacheHit: false,
    recovery: { policy: "one-controlled-recovery", used: attempts.length > 1, succeeded: recovered, attempts },
  };
}

async function readRecoveryCache(cachePath: string): Promise<AgenticPlannerRecoveryResult | null> {
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as AgenticPlannerRecoveryResult;
    parseAgenticRewrite(JSON.stringify(cached.rewrite));
    if (cached.recovery?.policy !== "one-controlled-recovery" || !Array.isArray(cached.recovery.attempts)) throw new Error(`Invalid agentic planner recovery cache entry ${cachePath}.`);
    return cached;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function persistRecovery(cacheDirectory: string, cachePath: string, result: AgenticPlannerRecoveryResult) {
  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`);
}

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
