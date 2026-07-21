import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type JudgeScores = {
  groundedness: number | null;
  keyFactCoverage: number | null;
  citationCorrectness: number | null;
  citationCompleteness: number | null;
  directness: number | null;
  correctAbstention: number | null;
};

export type JudgeOutput = {
  answerability: "answerable" | "unanswerable";
  scores: JudgeScores;
  flags: {
    criticalUnsupportedClaim: boolean;
    contradictsEvidence: boolean;
    invalidCitationLabel: boolean;
    generatorFailure: boolean;
  };
  rationale: string;
  unsupportedClaims: string[];
  missingKeyFacts: string[];
  citationIssues: string[];
};

export type JudgeCandidate = {
  id: string;
  model: string;
  expectedResponseModel: string;
  expectedResponseProvider: string;
  providerOrder: string[];
  reasoningEffort: "low" | "medium" | "high";
  inputPriceUsdPerMillionTokens: number;
  outputPriceUsdPerMillionTokens: number;
};

export type JudgeResult = {
  output: JudgeOutput;
  responseModel: string;
  responseProvider: string;
  responseId: string | null;
  finishReason: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    totalTokens: number;
    costUsd: number;
    costSource: "provider-reported" | "list-price-estimate";
  };
  latencyMs: number;
  cacheHit: boolean;
};

type Options = {
  candidate: JudgeCandidate;
  systemInstruction: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  cacheDirectory?: string;
  allowProviderRequests?: boolean;
  fetchImplementation?: typeof fetch;
};

type OpenRouterResponse = {
  id?: string;
  model?: string;
  provider?: string;
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

export async function judgeWithOpenRouter(options: Options): Promise<JudgeResult> {
  if (!options.candidate.providerOrder.length) throw new Error("The judge must pin an OpenRouter provider.");
  const cacheDirectory = path.resolve(options.cacheDirectory ?? "data/judge-cache");
  const cacheKey = judgeCacheKey(options);
  const cachePath = path.join(cacheDirectory, `${cacheKey}.json`);
  const cached = await readCache(cachePath);
  if (cached) return { ...cached, cacheHit: true };
  if (options.allowProviderRequests === false) throw new Error(`Judge cache miss ${cacheKey}; provider requests are disabled.`);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for judge requests.");

  const started = performance.now();
  const response = await (options.fetchImplementation ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/retriq-thesis/retriq",
      "X-OpenRouter-Title": "Retriq thesis LLM judge calibration",
    },
    body: JSON.stringify({
      model: options.candidate.model,
      messages: [
        { role: "system", content: options.systemInstruction },
        { role: "user", content: options.userPrompt },
      ],
      temperature: 0,
      max_completion_tokens: options.maxOutputTokens,
      reasoning: { effort: options.candidate.reasoningEffort, exclude: true },
      response_format: {
        type: "json_schema",
        json_schema: { name: "retriq_judge_v1", strict: true, schema: options.schema },
      },
      provider: { order: options.candidate.providerOrder, allow_fallbacks: false },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status} for ${options.candidate.id}: ${raw.slice(0, 1000)}`);
  const payload = JSON.parse(raw) as OpenRouterResponse;
  if (payload.model !== options.candidate.expectedResponseModel) throw new Error(`Judge returned model ${payload.model ?? "unknown"}; expected ${options.candidate.expectedResponseModel}.`);
  if (payload.provider !== options.candidate.expectedResponseProvider) throw new Error(`Judge returned provider ${payload.provider ?? "unknown"}; expected ${options.candidate.expectedResponseProvider}.`);
  const content = readText(payload);
  if (!content) throw new Error("Judge returned an empty structured response.");
  const output = validateJudgeOutput(JSON.parse(content) as unknown);
  const usage = payload.usage;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const result: JudgeResult = {
    output,
    responseModel: payload.model,
    responseProvider: payload.provider,
    responseId: payload.id ?? null,
    finishReason: payload.choices?.[0]?.finish_reason ?? null,
    usage: {
      promptTokens,
      completionTokens,
      reasoningTokens,
      cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
      costUsd: usage?.cost ?? estimateCost(promptTokens, completionTokens, options.candidate),
      costSource: usage?.cost === undefined ? "list-price-estimate" : "provider-reported",
    },
    latencyMs: Number((performance.now() - started).toFixed(2)),
    cacheHit: false,
  };
  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function judgeCacheKey(options: Pick<Options, "candidate" | "systemInstruction" | "userPrompt" | "schema" | "maxOutputTokens">) {
  return sha256(JSON.stringify({
    schemaVersion: 1,
    candidate: options.candidate,
    systemInstruction: options.systemInstruction,
    userPrompt: options.userPrompt,
    schema: options.schema,
    maxOutputTokens: options.maxOutputTokens,
    temperature: 0,
  }));
}

export function buildJudgeResponseSchema(baseSchema: Record<string, unknown>, answerability: "answerable" | "unanswerable") {
  const schema = structuredClone(baseSchema) as {
    properties: {
      answerability: Record<string, unknown>;
      scores: { properties: Record<keyof JudgeScores, Record<string, unknown>> };
    };
  };
  schema.properties.answerability = { type: "string", const: answerability };
  const maxima: Record<keyof JudgeScores, number> = {
    groundedness: 4, keyFactCoverage: 4, citationCorrectness: 4,
    citationCompleteness: 4, directness: 2, correctAbstention: 1,
  };
  for (const [key, maximum] of Object.entries(maxima) as Array<[keyof JudgeScores, number]>) {
    const applicable = answerability === "answerable" ? key !== "correctAbstention" : key === "correctAbstention";
    schema.properties.scores.properties[key] = applicable
      ? { type: "integer", minimum: 0, maximum }
      : { type: "null" };
  }
  return schema as unknown as Record<string, unknown>;
}

export function validateJudgeOutput(value: unknown): JudgeOutput {
  if (!value || typeof value !== "object") throw new Error("Judge output must be an object.");
  const output = value as JudgeOutput;
  if (output.answerability !== "answerable" && output.answerability !== "unanswerable") throw new Error("Invalid judge answerability.");
  if (!output.scores || !output.flags) throw new Error("Judge output is missing scores or flags.");
  const scoreRanges: Array<[keyof JudgeScores, number]> = [
    ["groundedness", 4], ["keyFactCoverage", 4], ["citationCorrectness", 4],
    ["citationCompleteness", 4], ["directness", 2], ["correctAbstention", 1],
  ];
  for (const [key, maximum] of scoreRanges) {
    const score = output.scores[key];
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > maximum)) throw new Error(`Invalid ${key} score.`);
  }
  const answerableKeys: Array<keyof JudgeScores> = ["groundedness", "keyFactCoverage", "citationCorrectness", "citationCompleteness", "directness"];
  if (output.answerability === "answerable") {
    if (answerableKeys.some((key) => output.scores[key] === null) || output.scores.correctAbstention !== null) throw new Error("Answerable judge output has invalid nullability.");
  } else if (answerableKeys.some((key) => output.scores[key] !== null) || output.scores.correctAbstention === null) {
    throw new Error("Unanswerable judge output has invalid nullability.");
  }
  for (const key of ["criticalUnsupportedClaim", "contradictsEvidence", "invalidCitationLabel", "generatorFailure"] as const) {
    if (typeof output.flags[key] !== "boolean") throw new Error(`Invalid ${key} flag.`);
  }
  if (typeof output.rationale !== "string" || !output.rationale.trim()) throw new Error("Judge rationale is required.");
  for (const key of ["unsupportedClaims", "missingKeyFacts", "citationIssues"] as const) {
    if (!Array.isArray(output[key]) || output[key].some((item) => typeof item !== "string")) throw new Error(`Invalid ${key} list.`);
  }
  return output;
}

async function readCache(cachePath: string): Promise<JudgeResult | null> {
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as JudgeResult;
    validateJudgeOutput(cached.output);
    if (!cached.responseModel || !cached.responseProvider || !cached.usage) throw new Error(`Invalid judge cache entry ${cachePath}.`);
    return cached;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readText(payload: OpenRouterResponse) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n").trim();
  return "";
}

function estimateCost(inputTokens: number, outputTokens: number, candidate: JudgeCandidate) {
  return inputTokens / 1_000_000 * candidate.inputPriceUsdPerMillionTokens
    + outputTokens / 1_000_000 * candidate.outputPriceUsdPerMillionTokens;
}

function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
