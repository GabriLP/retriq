import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { RetrievalResult } from "./types";

export type SemanticAssessorCandidate = {
  id: string;
  model: string;
  expectedResponseModel: string;
  expectedResponseProvider: string;
  providerOrder: string[];
  reasoningEffort: "low" | "medium" | "high";
  maxOutputTokens: number;
  inputPriceUsdPerMillionTokens: number;
  outputPriceUsdPerMillionTokens: number;
};

export type SemanticEvidenceAssessment = {
  sufficient: boolean;
  reason: string;
  supportedAspects: string[];
  missingAspects: string[];
};

export type SemanticAssessorResult = {
  assessment: SemanticEvidenceAssessment;
  responseModel: string;
  responseProvider: string;
  responseId: string | null;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number; totalTokens: number; costUsd: number };
  latencyMs: number;
  cacheHit: boolean;
  providerInvoked: boolean;
};

type Options = {
  candidate: SemanticAssessorCandidate;
  question: string;
  chunks: RetrievalResult[];
  cacheDirectory?: string;
  allowProviderRequests?: boolean;
  fetchImplementation?: typeof fetch;
};

export const semanticAssessorInstructions = `Decide whether the retrieved documentation excerpts contain enough direct evidence to answer the original question accurately.
Judge only the shown evidence. Plausible topic overlap is not sufficient.
Reject excerpts about an adjacent framework, library, product, or unsupported version.
For comparisons, require direct evidence for every named technology or comparison side.
Do not answer the question. Return a concise structured assessment.`;

export async function assessEvidenceSemantically(options: Options): Promise<SemanticAssessorResult> {
  if (!options.chunks.length) return deterministicEmptyResult();
  const cacheDirectory = path.resolve(options.cacheDirectory ?? "data/semantic-assessor-cache");
  const userPrompt = buildSemanticAssessorPrompt(options.question, options.chunks);
  const key = semanticAssessorCacheKey(options.candidate, userPrompt);
  const cachePath = path.join(cacheDirectory, `${key}.json`);
  const cached = await readCache(cachePath);
  if (cached) return { ...cached, cacheHit: true };
  if (options.allowProviderRequests === false) throw new Error(`Semantic assessor cache miss ${key}; provider requests are disabled.`);
  const apiKey = process.env.OPENROUTER_API_KEY ?? (options.fetchImplementation ? "test-key" : undefined);
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for semantic assessor requests.");
  const started = performance.now();
  const response = await (options.fetchImplementation ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/retriq-thesis/retriq", "X-OpenRouter-Title": "Retriq semantic evidence assessor" },
    body: JSON.stringify({
      model: options.candidate.model,
      messages: [{ role: "system", content: semanticAssessorInstructions }, { role: "user", content: userPrompt }],
      temperature: 0,
      max_completion_tokens: options.candidate.maxOutputTokens,
      reasoning: { effort: options.candidate.reasoningEffort, exclude: true },
      response_format: { type: "json_schema", json_schema: { name: "retriq_semantic_evidence_v1", strict: true, schema: semanticAssessorSchema } },
      provider: { order: options.candidate.providerOrder, allow_fallbacks: false },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status} for ${options.candidate.id}: ${raw.slice(0, 1000)}`);
  const payload = JSON.parse(raw) as OpenRouterPayload;
  if (payload.model !== options.candidate.expectedResponseModel || payload.provider !== options.candidate.expectedResponseProvider) throw new Error(`Semantic assessor routing mismatch: ${payload.model ?? "unknown"}/${payload.provider ?? "unknown"}.`);
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Semantic assessor returned an empty structured response.");
  const assessment = validateSemanticAssessment(JSON.parse(content));
  const usage = payload.usage;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const result: SemanticAssessorResult = {
    assessment,
    responseModel: payload.model,
    responseProvider: payload.provider,
    responseId: payload.id ?? null,
    finishReason: payload.choices?.[0]?.finish_reason ?? null,
    usage: {
      promptTokens,
      completionTokens,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
      costUsd: usage?.cost ?? promptTokens / 1_000_000 * options.candidate.inputPriceUsdPerMillionTokens + completionTokens / 1_000_000 * options.candidate.outputPriceUsdPerMillionTokens,
    },
    latencyMs: Number((performance.now() - started).toFixed(2)), cacheHit: false, providerInvoked: true,
  };
  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function buildSemanticAssessorPrompt(question: string, chunks: RetrievalResult[]) {
  return `Original question:\n${question.trim()}\n\nRetrieved documentation excerpts:\n${chunks.slice(0, 4).map((chunk) => `[S${chunk.rank}] ${chunk.title} — ${chunk.section}\nLanguage: ${chunk.language ?? "unknown"}\n${chunk.content}`).join("\n\n")}`;
}

export function validateSemanticAssessment(value: unknown): SemanticEvidenceAssessment {
  if (!value || typeof value !== "object") throw new Error("Semantic assessment must be an object.");
  const output = value as SemanticEvidenceAssessment;
  if (typeof output.sufficient !== "boolean" || typeof output.reason !== "string" || !output.reason.trim()) throw new Error("Semantic assessment has invalid sufficiency or reason.");
  for (const key of ["supportedAspects", "missingAspects"] as const) if (!Array.isArray(output[key]) || output[key].some((item) => typeof item !== "string")) throw new Error(`Semantic assessment has invalid ${key}.`);
  return { sufficient: output.sufficient, reason: output.reason.trim(), supportedAspects: output.supportedAspects, missingAspects: output.missingAspects };
}

export function semanticAssessorCacheKey(candidate: SemanticAssessorCandidate, userPrompt: string) {
  return crypto.createHash("sha256").update(JSON.stringify({ schemaVersion: 1, candidate, system: semanticAssessorInstructions, userPrompt, schema: semanticAssessorSchema })).digest("hex");
}

const semanticAssessorSchema = {
  type: "object", additionalProperties: false, required: ["sufficient", "reason", "supportedAspects", "missingAspects"],
  properties: {
    sufficient: { type: "boolean" }, reason: { type: "string", minLength: 1, maxLength: 500 },
    supportedAspects: { type: "array", maxItems: 8, items: { type: "string" } },
    missingAspects: { type: "array", maxItems: 8, items: { type: "string" } },
  },
};

type OpenRouterPayload = { id?: string; model?: string; provider?: string; choices?: Array<{ finish_reason?: string | null; message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number } } };

function deterministicEmptyResult(): SemanticAssessorResult { return { assessment: { sufficient: false, reason: "No evidence passed the retrieval gate.", supportedAspects: [], missingAspects: ["retrievable-evidence"] }, responseModel: "deterministic-empty-gate", responseProvider: "local", responseId: null, finishReason: "deterministic", usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0 }, latencyMs: 0, cacheHit: true, providerInvoked: false }; }
async function readCache(cachePath: string) { try { const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as SemanticAssessorResult; validateSemanticAssessment(cached.assessment); return cached; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
