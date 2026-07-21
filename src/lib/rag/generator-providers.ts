import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { FinishReason, ThinkingLevel } from "@google/genai";

import { getGeminiClient } from "./gemini-client";

export type GeneratorCandidate = {
  id: string;
  provider: "google" | "openrouter";
  model: string;
  expectedResponseModel?: string;
  expectedResponseProvider?: string;
  providerOrder?: string[];
  allowFallbacks?: false;
  reasoningEffort: "low" | "medium";
  inputPriceUsdPerMillionTokens: number;
  outputPriceUsdPerMillionTokens: number;
};

export type GeneratorUsage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costUsd: number;
  costSource: "provider-reported" | "list-price-estimate";
};

export type GeneratorResult = {
  answer: string;
  responseModel: string;
  responseProvider: string;
  responseId: string | null;
  finishReason: string | null;
  truncated: boolean | null;
  usage: GeneratorUsage;
  latencyMs: number;
  cacheHit: boolean;
};

type GenerateOptions = {
  candidate: GeneratorCandidate;
  systemInstruction: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  cacheDirectory?: string;
  allowProviderRequests?: boolean;
  fetchImplementation?: typeof fetch;
};

type OpenRouterResponse = {
  id?: string;
  model?: string;
  provider?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | Array<{ type?: string; text?: string }> };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

export async function generateWithCandidate(options: GenerateOptions): Promise<GeneratorResult> {
  validateCandidate(options.candidate);
  const cacheDirectory = path.resolve(options.cacheDirectory ?? "data/generation-cache");
  const cacheKey = sha256(JSON.stringify({
    schemaVersion: 1,
    candidate: options.candidate,
    systemInstruction: options.systemInstruction,
    userPrompt: options.userPrompt,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
  }));
  const cachePath = path.join(cacheDirectory, `${cacheKey}.json`);
  const cached = await readCache(cachePath);
  if (cached) return { ...cached, cacheHit: true };
  if (options.allowProviderRequests === false) throw new Error(`Generator cache miss for ${options.candidate.id}; provider requests are disabled.`);

  const result = options.candidate.provider === "google"
    ? await generateWithGoogle(options)
    : await generateWithOpenRouter(options);
  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify({ ...result, cacheHit: false }, null, 2)}\n`);
  return result;
}

async function generateWithGoogle(options: GenerateOptions): Promise<GeneratorResult> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for the Google generator.");
  const started = performance.now();
  const response = await getGeminiClient().models.generateContent({
    model: options.candidate.model,
    contents: options.userPrompt,
    config: {
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      thinkingConfig: { thinkingLevel: options.candidate.reasoningEffort === "low" ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM },
    },
  });
  const answer = response.text?.trim();
  if (!answer) throw new Error(`${options.candidate.id} returned an empty answer.`);
  const usage = response.usageMetadata;
  const promptTokens = usage?.promptTokenCount ?? 0;
  const completionTokens = usage?.candidatesTokenCount ?? 0;
  const reasoningTokens = usage?.thoughtsTokenCount ?? 0;
  return {
    answer,
    responseModel: response.modelVersion ?? options.candidate.model,
    responseProvider: "google",
    responseId: response.responseId ?? null,
    finishReason: response.candidates?.[0]?.finishReason ?? null,
    truncated: response.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS,
    usage: {
      promptTokens,
      completionTokens,
      reasoningTokens,
      cachedTokens: usage?.cachedContentTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? promptTokens + completionTokens + reasoningTokens,
      costUsd: estimateCost(promptTokens, completionTokens + reasoningTokens, options.candidate),
      costSource: "list-price-estimate",
    },
    latencyMs: round(performance.now() - started),
    cacheHit: false,
  };
}

async function generateWithOpenRouter(options: GenerateOptions): Promise<GeneratorResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouter generators.");
  const started = performance.now();
  const response = await (options.fetchImplementation ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/retriq-thesis/retriq",
      "X-OpenRouter-Title": "Retriq thesis generator benchmark",
    },
    body: JSON.stringify({
      model: options.candidate.model,
      messages: [
        { role: "system", content: options.systemInstruction },
        { role: "user", content: options.userPrompt },
      ],
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
      reasoning: { effort: options.candidate.reasoningEffort },
      provider: { order: options.candidate.providerOrder, allow_fallbacks: false },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status} for ${options.candidate.id}: ${raw.slice(0, 1000)}`);
  const payload = JSON.parse(raw) as OpenRouterResponse;
  const expectedModel = options.candidate.expectedResponseModel ?? options.candidate.model;
  if (payload.model !== expectedModel) throw new Error(`${options.candidate.id} returned model ${payload.model ?? "unknown"}; expected ${expectedModel}.`);
  if (options.candidate.expectedResponseProvider && payload.provider !== options.candidate.expectedResponseProvider) {
    throw new Error(`${options.candidate.id} returned provider ${payload.provider ?? "unknown"}; expected ${options.candidate.expectedResponseProvider}.`);
  }
  const answer = readOpenRouterText(payload);
  if (!answer) throw new Error(`${options.candidate.id} returned an empty answer.`);
  const usage = payload.usage;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const reportedCost = usage?.cost;
  return {
    answer,
    responseModel: payload.model,
    responseProvider: payload.provider ?? options.candidate.providerOrder?.[0] ?? "unknown",
    responseId: payload.id ?? null,
    finishReason: payload.choices?.[0]?.finish_reason ?? null,
    truncated: payload.choices?.[0]?.finish_reason === "length",
    usage: {
      promptTokens,
      completionTokens,
      reasoningTokens,
      cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
      costUsd: reportedCost ?? estimateCost(promptTokens, completionTokens, options.candidate),
      costSource: reportedCost === undefined ? "list-price-estimate" : "provider-reported",
    },
    latencyMs: round(performance.now() - started),
    cacheHit: false,
  };
}

function validateCandidate(candidate: GeneratorCandidate) {
  if (candidate.provider === "openrouter") {
    if (!candidate.providerOrder?.length) throw new Error(`${candidate.id} must pin at least one OpenRouter provider.`);
    if (candidate.allowFallbacks !== false) throw new Error(`${candidate.id} must explicitly disable OpenRouter fallbacks.`);
  }
}

function readOpenRouterText(payload: OpenRouterResponse) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n").trim();
  return "";
}

async function readCache(cachePath: string): Promise<GeneratorResult | null> {
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as Partial<GeneratorResult>;
    if (!cached.answer || !cached.responseModel || !cached.responseProvider || !cached.usage) {
      throw new Error(`Invalid generator cache entry ${cachePath}.`);
    }
    // Cache entries created before stop-reason capture remain usable, but an
    // absent field is explicitly unknown rather than incorrectly treated as a
    // natural stop.
    return {
      ...cached,
      responseId: cached.responseId ?? null,
      finishReason: cached.finishReason ?? null,
      truncated: cached.truncated ?? null,
      latencyMs: cached.latencyMs ?? 0,
      cacheHit: cached.cacheHit ?? false,
    } as GeneratorResult;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function estimateCost(inputTokens: number, outputTokens: number, candidate: GeneratorCandidate) {
  return inputTokens / 1_000_000 * candidate.inputPriceUsdPerMillionTokens
    + outputTokens / 1_000_000 * candidate.outputPriceUsdPerMillionTokens;
}

function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function round(value: number) { return Number(value.toFixed(2)); }
