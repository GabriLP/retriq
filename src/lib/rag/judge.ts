import { ragConfig } from "./config";
import { getGeminiClient } from "./gemini-client";
import { buildJudgePrompt, judgeInstructions } from "./prompt";
import type { JudgeAssessment, RetrievalResult } from "./types";

const disabledAssessment: JudgeAssessment = {
  enabled: false,
  verdict: "disabled",
  groundedness: null,
  citationCorrectness: null,
  completeness: null,
  rationale: "LLM-as-a-judge is disabled.",
  unsupportedClaims: [],
  missingInformation: [],
};

type RawJudgeAssessment = {
  groundedness?: unknown;
  citationCorrectness?: unknown;
  completeness?: unknown;
  rationale?: unknown;
  unsupportedClaims?: unknown;
  missingInformation?: unknown;
};

export async function judgeGroundedAnswer(
  question: string,
  answer: string,
  chunks: RetrievalResult[],
): Promise<JudgeAssessment> {
  if (!ragConfig.judgeEnabled) return disabledAssessment;

  try {
    const response = await getGeminiClient().models.generateContent({
      model: ragConfig.judgeModel,
      contents: buildJudgePrompt(question, answer, chunks),
      config: {
        maxOutputTokens: 700,
        responseMimeType: "application/json",
        systemInstruction: judgeInstructions,
      },
    });

    return normalizeJudgeAssessment(response.text);
  } catch (error) {
    // Evaluation failure must not make an otherwise valid documentation answer
    // unavailable. The error is represented in the response and local log.
    return {
      enabled: true,
      verdict: "unavailable",
      groundedness: null,
      citationCorrectness: null,
      completeness: null,
      rationale: error instanceof Error ? `Judge unavailable: ${error.message}` : "Judge unavailable.",
      unsupportedClaims: [],
      missingInformation: [],
      model: ragConfig.judgeModel,
    };
  }
}

function normalizeJudgeAssessment(text: string | undefined): JudgeAssessment {
  let parsed: RawJudgeAssessment;

  try {
    parsed = JSON.parse(text ?? "") as RawJudgeAssessment;
  } catch {
    return {
      enabled: true,
      verdict: "unavailable",
      groundedness: null,
      citationCorrectness: null,
      completeness: null,
      rationale: "Judge returned an invalid structured response.",
      unsupportedClaims: [],
      missingInformation: [],
      model: ragConfig.judgeModel,
    };
  }

  const groundedness = normalizeScore(parsed.groundedness);
  const citationCorrectness = normalizeScore(parsed.citationCorrectness);
  const completeness = normalizeScore(parsed.completeness);
  const scores = [groundedness, citationCorrectness, completeness];
  const minimumScore = Math.min(...scores);

  return {
    enabled: true,
    verdict: minimumScore >= 4 ? "pass" : minimumScore >= 3 ? "needs_review" : "fail",
    groundedness,
    citationCorrectness,
    completeness,
    rationale: normalizeText(parsed.rationale, "Judge completed without a rationale."),
    unsupportedClaims: normalizeTextList(parsed.unsupportedClaims),
    missingInformation: normalizeTextList(parsed.missingInformation),
    model: ragConfig.judgeModel,
  };
}

function normalizeScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 1;
  return Math.max(1, Math.min(5, Math.round(score)));
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1_000) : fallback;
}

function normalizeTextList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 500)).slice(0, 10);
}
