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
  queryPatterns: RegExp[];
  languagePatterns: RegExp[];
  versionPattern?: RegExp;
  manifestVersionPattern?: RegExp;
};

const RULES: TechnologyRule[] = [
  absent("react-native", [/\bReact\s+Native\b/i]),
  absent("aws-rds", [/\bAWS\s+RDS\b/i, /\bRDS\s+PostgreSQL\b/i]),
  absent("android", [/\bAndroid\b/i, /\bandroid\.[a-z.]+/i]),
  absent("django", [/\bDjango\b/i]),
  absent("angular", [/\bAngular\b/i, /@NgModule\b/i]),
  absent("csharp", [/\bC#\b/i, /\b\.NET\b/i, /\bIQueryable\b/i]),
  absent("swift", [/\bSwift\b/i, /\bSendable\b/]),
  absent("ruby", [/\bRuby\b/i, /\bRails\b/i, /\bActive\s+Record\b/i]),
  absent("haskell", [/\bHaskell\b/i, /\bSoftware\s+Transactional\s+Memory\b/i]),
  technology("postgresql", [/\bPostgreSQL\b/i], [/PostgreSQL/i], /\bPostgreSQL\s+(\d+(?:\.\d+)*)\b/i, /\b(\d+)(?:\.\d+)?/),
  technology("java", [/\bJava(?:\s+SE)?\b/i], [/^Java$/i], /\bJava(?:\s+SE)?\s+(\d+)\b/i, /Java\s+SE\s+(\d+)/i),
  technology("react", [/\bReact\b/i], [/^React$/i]),
  technology("python", [/\bPython\b/i], [/^Python$/i], /\bPython\s+(\d+)(?:\.\d+)?\b/i, /\b(\d+)\.x\b/i),
  technology("kotlin", [/\bKotlin\b/i], [/^Kotlin$/i], /\bKotlin\s+(\d+)(?:\.\d+)?\b/i, /\b(\d+)(?:\.\d+)?/),
  technology("typescript", [/\bTypeScript\b/i], [/^TypeScript$/i]),
  technology("rust", [/\bRust\b/i], [/^Rust$/i]),
  technology("go", [/\bGo\s+(?:language|version|1\.)/i, /\bGolang\b/i], [/^Go$/i], /\bGo(?:lang)?\s+(?:version\s+)?(\d+)(?:\.\d+)?\b/i, /go(\d+)(?:\.\d+)?/i),
  technology("bash", [/\bBash\b/i], [/^Bash$/i], /\bBash\s+(\d+)(?:\.\d+)?\b/i, /\b(\d+)(?:\.\d+)?/),
  technology("cpp", [/\bC\+\+\b/], [/^C\+\+$/i]),
  technology("c", [/\bC(?:11|17|23|26)?\b/], [/^C$/], /\bC(11|17|23|26)\b/, /\bC(11|17|23|26)\b/),
];

export function filterChunksByQueryMetadata(query: string, chunks: DocumentationChunk[]) {
  const rule = RULES.find((candidate) => candidate.queryPatterns.some((pattern) => pattern.test(query)));
  if (!rule) return { chunks, decision: compatible(null, null, [], "No supported technology or version constraint was detected.") };
  const requestedVersion = extractNumber(query, rule.versionPattern);
  const technologyChunks = chunks.filter((chunk) => chunk.language && rule.languagePatterns.some((pattern) => pattern.test(chunk.language!)));
  if (!technologyChunks.length) {
    return { chunks: [], decision: { status: "unsupported-technology", requestedTechnology: rule.id, requestedVersion, availableVersions: [], reason: `The corpus contains no documentation tagged for '${rule.id}'.` } satisfies CompatibilityDecision };
  }
  const availableVersions = uniqueNumbers(technologyChunks.map((chunk) => extractNumber(chunk.version ?? "", rule.manifestVersionPattern)));
  if (requestedVersion !== null && availableVersions.length && !availableVersions.includes(requestedVersion)) {
    return { chunks: [], decision: { status: "unsupported-version", requestedTechnology: rule.id, requestedVersion, availableVersions, reason: `Requested ${rule.id} version ${requestedVersion}, while indexed version metadata contains ${availableVersions.join(", ")}.` } satisfies CompatibilityDecision };
  }
  const versionChunks = requestedVersion === null || !availableVersions.length
    ? technologyChunks
    : technologyChunks.filter((chunk) => extractNumber(chunk.version ?? "", rule.manifestVersionPattern) === requestedVersion);
  return { chunks: versionChunks, decision: compatible(rule.id, requestedVersion, availableVersions, `Restricted retrieval to ${versionChunks.length} metadata-compatible chunks.`) };
}

function technology(id: string, queryPatterns: RegExp[], languagePatterns: RegExp[], versionPattern?: RegExp, manifestVersionPattern?: RegExp): TechnologyRule {
  return { id, queryPatterns, languagePatterns, versionPattern, manifestVersionPattern };
}

function absent(id: string, queryPatterns: RegExp[]): TechnologyRule {
  return technology(id, queryPatterns, [new RegExp(`^${escapeRegex(id)}$`, "i")]);
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
