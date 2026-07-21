import type { DocumentationChunk } from "./types";

export type CompatibilityDecision = {
  status: "compatible" | "unsupported-technology" | "unsupported-version";
  requestedTechnology: string | null;
  requestedVersion: number | null;
  availableVersions: number[];
  reason: string;
};

type TechnologyRule = {
  id: string;
  corpusSupported: boolean;
  queryPatterns: RegExp[];
  languagePatterns: RegExp[];
  databaseLanguages: string[];
  versionPattern?: RegExp;
  manifestVersionPattern?: RegExp;
};

const RULES: TechnologyRule[] = [
  absent("react-native", [/\bReact\s+Native\b/i], ["React Native"]),
  absent("aws-rds", [/\bAWS\s+RDS\b/i, /\bRDS\s+PostgreSQL\b/i], ["AWS RDS"]),
  absent("android", [/\bAndroid\b/i, /\bandroid\.[a-z.]+/i], ["Android"]),
  absent("django", [/\bDjango\b/i], ["Django"]),
  absent("angular", [/\bAngular\b/i, /@NgModule\b/i], ["Angular"]),
  absent("csharp", [/\bC#\b/i, /\b\.NET\b/i, /\bIQueryable\b/i], ["C#"]),
  absent("swift", [/\bSwift\b/i, /\bSendable\b/], ["Swift"]),
  absent("ruby", [/\bRuby\b/i, /\bRails\b/i, /\bActive\s+Record\b/i], ["Ruby"]),
  absent("haskell", [/\bHaskell\b/i, /\bSoftware\s+Transactional\s+Memory\b/i], ["Haskell"]),
  technology("postgresql", [/\bPostgreSQL\b/i], [/PostgreSQL/i], ["PostgreSQL / SQL"], /\bPostgreSQL\s+(\d+(?:\.\d+)*)\b/i, /\b(\d+)(?:\.\d+)?/),
  technology("java", [/\bJava(?:\s+SE)?\b/i], [/^Java$/i], ["Java"], /\bJava(?:\s+SE)?\s+(\d+)\b/i, /Java\s+SE\s+(\d+)/i),
  technology("react", [/\bReact\b(?!\s+Native\b)/i], [/^React$/i], ["React"]),
  technology("python", [/\bPython\b/i], [/^Python$/i], ["Python"], /\bPython\s+(\d+)(?:\.\d+)?\b/i, /\b(\d+)\.x\b/i),
  technology("kotlin", [/\bKotlin\b/i], [/^Kotlin$/i], ["Kotlin"], /\bKotlin\s+(\d+)(?:\.\d+)?\b/i, /\b(\d+)(?:\.\d+)?/),
  technology("typescript", [/\bTypeScript\b/i], [/^TypeScript$/i], ["TypeScript"]),
  technology("javascript", [/\bJavaScript\b/i, /\bECMAScript\b/i], [/^JavaScript$/i], ["JavaScript"]),
  technology("rust", [/\bRust\b/i], [/^Rust$/i], ["Rust"]),
  technology("go", [/\bGo\s+(?:language|version|1\.)/i, /\bGolang\b/i], [/^Go$/i], ["Go"], /\bGo(?:lang)?\s+(?:version\s+)?(\d+)(?:\.\d+)?\b/i, /go(\d+)(?:\.\d+)?/i),
  technology("bash", [/\bBash\b/i], [/^Bash$/i], ["Bash"], /\bBash\s+(\d+)(?:\.\d+)?\b/i, /\b(\d+)(?:\.\d+)?/),
  technology("cpp", [/\bC\+\+(?!\w)/i], [/^C\+\+$/i], ["C++"]),
  technology("c", [/\bC(?!\+\+)(?:11|17|23|26)?\b/], [/^C$/], ["C"], /\bC(11|17|23|26)\b/, /\bC(11|17|23|26)\b/),
];

export type QueryMetadataConstraint = { technology: string; databaseLanguages: string[]; requestedVersion: number | null };

export function detectQueryMetadataConstraint(query: string): QueryMetadataConstraint | null {
  const rules = matchingRules(query);
  if (!rules.length) return null;
  return {
    technology: rules.map((rule) => rule.id).join("+"),
    databaseLanguages: [...new Set(rules.flatMap((rule) => rule.databaseLanguages))],
    requestedVersion: rules.length === 1 ? extractNumber(query, rules[0].versionPattern) : null,
  };
}

export function filterChunksByQueryMetadata<T extends DocumentationChunk>(query: string, chunks: T[]) {
  const rules = matchingRules(query);
  if (!rules.length) return { chunks, decision: compatible(null, null, [], "No supported technology or version constraint was detected.") };
  const requestedTechnology = rules.map((rule) => rule.id).join("+");
  const requestedVersion = rules.length === 1 ? extractNumber(query, rules[0].versionPattern) : null;
  const technologyChunks = chunks.filter((chunk) => chunk.language && rules.some((rule) => rule.languagePatterns.some((pattern) => pattern.test(chunk.language!))));
  if (!technologyChunks.length) {
    return { chunks: [], decision: { status: "unsupported-technology", requestedTechnology, requestedVersion, availableVersions: [], reason: `The corpus contains no documentation tagged for '${requestedTechnology}'.` } satisfies CompatibilityDecision };
  }
  const availableVersions = rules.length === 1
    ? uniqueNumbers(technologyChunks.map((chunk) => extractNumber(chunk.version ?? "", rules[0].manifestVersionPattern)))
    : [];
  if (requestedVersion !== null && availableVersions.length && !availableVersions.includes(requestedVersion)) {
    return { chunks: [], decision: { status: "unsupported-version", requestedTechnology, requestedVersion, availableVersions, reason: `Requested ${requestedTechnology} version ${requestedVersion}, while indexed version metadata contains ${availableVersions.join(", ")}.` } satisfies CompatibilityDecision };
  }
  const versionChunks = requestedVersion === null || !availableVersions.length
    ? technologyChunks
    : technologyChunks.filter((chunk) => extractNumber(chunk.version ?? "", rules[0].manifestVersionPattern) === requestedVersion);
  return { chunks: versionChunks, decision: compatible(requestedTechnology, requestedVersion, availableVersions, `Restricted retrieval to ${versionChunks.length} metadata-compatible chunks.`) };
}

function matchingRules(query: string) {
  const matches = RULES.filter((candidate) => candidate.queryPatterns.some((pattern) => pattern.test(query)));
  if (!matches.length) return [];
  // Preserve the existing conservative behavior for technologies known to be
  // outside the corpus (for example React Native rather than React).
  if (!matches[0].corpusSupported) return [matches[0]];
  return matches.filter((rule) => rule.corpusSupported);
}

function technology(id: string, queryPatterns: RegExp[], languagePatterns: RegExp[], databaseLanguages: string[], versionPattern?: RegExp, manifestVersionPattern?: RegExp): TechnologyRule {
  return { id, corpusSupported: true, queryPatterns, languagePatterns, databaseLanguages, versionPattern, manifestVersionPattern };
}

function absent(id: string, queryPatterns: RegExp[], databaseLanguages: string[]): TechnologyRule {
  return { ...technology(id, queryPatterns, [new RegExp(`^${escapeRegex(id)}$`, "i")], databaseLanguages), corpusSupported: false };
}

function compatible(requestedTechnology: string | null, requestedVersion: number | null, availableVersions: number[], reason: string): CompatibilityDecision {
  return { status: "compatible", requestedTechnology, requestedVersion, availableVersions, reason };
}

function extractNumber(value: string, pattern?: RegExp) {
  if (!pattern) return null;
  const match = value.match(pattern);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function uniqueNumbers(values: Array<number | null>) {
  return [...new Set(values.filter((value): value is number => value !== null))].sort((left, right) => left - right);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
