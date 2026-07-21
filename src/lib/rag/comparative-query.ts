export type ComparativeSubqueryStrategy = "focus-original" | "topic-template";

export type ComparativeSubqueryResult = {
  subqueries: Record<string, string>;
  parsed: boolean;
  topic: string | null;
};

export function buildComparativeSubqueries(
  question: string,
  languages: string[],
  strategy: ComparativeSubqueryStrategy,
): ComparativeSubqueryResult {
  if (languages.length !== 2 || new Set(languages).size !== 2) {
    throw new Error("Comparative decomposition requires exactly two distinct languages.");
  }
  if (strategy === "focus-original") {
    return {
      subqueries: Object.fromEntries(
        languages.map((language) => [language, `Focus on ${language} only. ${question.trim()}`]),
      ),
      parsed: true,
      topic: question.trim(),
    };
  }

  const topic = extractComparativeTopic(question, languages);
  return {
    subqueries: Object.fromEntries(
      languages.map((language) => [
        language,
        topic
          ? `${language} documentation: ${sentence(topic)}`
          : `Focus on ${language} only. ${question.trim()}`,
      ]),
    ),
    parsed: topic !== null,
    topic,
  };
}

export function extractComparativeTopic(question: string, languages: string[]) {
  if (languages.length !== 2) return null;
  const pair = languages
    .map((language) => `(?:the\\s+)?${escapeRegex(language)}(?:\\s+language)?`)
    .join("\\s+and\\s+");
  const value = question.trim();
  const patterns = [
    new RegExp(`^How\\s+do\\s+${pair}\\s+differ\\s+in\\s+(.+?)[?]?$`, "i"),
    new RegExp(`^How\\s+are\\s+(.+?)\\s+in\\s+${pair}[?]?$`, "i"),
    new RegExp(`^How\\s+do\\s+${pair}\\s+(.+?)[?]?$`, "i"),
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function sentence(value: string) {
  const trimmed = value.trim().replace(/[?.!]+$/, "");
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
