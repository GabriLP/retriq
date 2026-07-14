import fs from "node:fs/promises";
import path from "node:path";

type SourceMetadata = {
  id?: string;
  type?: "pdf" | "html" | "markdown";
  url?: string;
  language?: string;
  publisher?: string;
  family?: string;
  version?: string;
  documentRole?: string;
  authority?: string;
  stability?: string;
  snapshotPolicy?: string;
  license?: string;
};

type CorpusManifest = {
  name?: string;
  defaults?: SourceMetadata;
  targets?: {
    minimumLanguages?: number;
    minimumPdfDocuments?: number;
    minimumOfficialSourceFamilies?: number;
    maximumSingleLanguageEndpointShare?: number;
  };
  sources: Array<string | SourceMetadata>;
};

type AuditedSource = Required<Pick<SourceMetadata, "type" | "language" | "family">> &
  SourceMetadata & { manifest: string; endpoint: string };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifests = await Promise.all(
    options.manifests.map(async (manifestPath) => ({
      path: manifestPath,
      value: JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8")) as CorpusManifest,
    })),
  );
  const sources: AuditedSource[] = [];
  const warnings: string[] = [];
  for (const manifest of manifests) {
    if (!Array.isArray(manifest.value.sources)) throw new Error(`${manifest.path} has no sources array.`);
    manifest.value.sources.forEach((source, index) => {
      const explicit = typeof source === "string" ? { url: source } : source;
      const merged = { ...manifest.value.defaults, ...explicit };
      const endpoint = merged.url ?? merged.id ?? `${manifest.path}#${index + 1}`;
      for (const field of ["type", "language", "family", "documentRole", "authority", "stability", "snapshotPolicy", "license"] as const) {
        if (!merged[field]) warnings.push(`${endpoint}: missing ${field}.`);
      }
      if (merged.type === "pdf" && !merged.version) warnings.push(`${endpoint}: PDF source is missing a version.`);
      sources.push({
        ...merged,
        type: merged.type ?? inferType(merged.url),
        language: merged.language ?? "unspecified",
        family: merged.family ?? "unspecified",
        manifest: manifest.value.name ?? manifest.path,
        endpoint,
      });
    });
  }

  const targets = Object.assign({}, ...manifests.map((manifest) => manifest.value.targets ?? {}));
  const languages = count(sources, (source) => source.language);
  const types = count(sources, (source) => source.type);
  const families = count(sources, (source) => source.family);
  const authorities = count(sources, (source) => source.authority ?? "unspecified");
  const roles = count(sources, (source) => source.documentRole ?? "unspecified");
  const officialFamilies = new Set(
    sources.filter((source) => source.authority?.includes("official") || source.authority?.includes("standards"))
      .map((source) => source.family),
  ).size;
  const largestLanguageShare = Math.max(...Object.values(languages)) / Math.max(sources.length, 1);
  const checks = [
    check("Minimum languages", Object.keys(languages).length, targets.minimumLanguages),
    check("Minimum PDF documents", types.pdf ?? 0, targets.minimumPdfDocuments),
    check("Minimum official source families", officialFamilies, targets.minimumOfficialSourceFamilies),
    checkMaximum("Maximum single-language endpoint share", largestLanguageShare, targets.maximumSingleLanguageEndpointShare),
  ];

  const outputBase = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputBase), { recursive: true });
  await fs.writeFile(
    `${outputBase}.json`,
    JSON.stringify({ generatedAt: new Date().toISOString(), manifests: options.manifests, sources, distributions: { languages, types, families, authorities, roles }, checks, warnings }, null, 2),
  );
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(sources, languages, types, families, authorities, roles, checks, warnings));
  console.log(`Audited ${sources.length} endpoints across ${Object.keys(languages).length} languages and ${Object.keys(families).length} source families.`);
  console.log(`Wrote ${outputBase}.md and ${outputBase}.json`);
}

function renderMarkdown(
  sources: AuditedSource[],
  languages: Record<string, number>,
  types: Record<string, number>,
  families: Record<string, number>,
  authorities: Record<string, number>,
  roles: Record<string, number>,
  checks: Array<{ name: string; status: string; actual: number; target?: number }>,
  warnings: string[],
) {
  return `# Corpus coverage audit

Generated: ${new Date().toISOString()}

- Document endpoints: **${sources.length}**
- Source families: **${Object.keys(families).length}**
- Languages/domains: **${Object.keys(languages).length}**
- PDF documents: **${types.pdf ?? 0}**

An endpoint is a URL or PDF entry. A source family groups related pages from the same publisher, so the React site is not incorrectly counted as dozens of independent sources.

## Coverage targets

| Check | Actual | Target | Status |
|---|---:|---:|---|
${checks.map((item) => `| ${item.name} | ${formatNumber(item.actual)} | ${item.target === undefined ? "not set" : formatNumber(item.target)} | ${item.status} |`).join("\n")}

## Distributions

| Dimension | Distribution |
|---|---|
| Languages | ${formatCounts(languages)} |
| Formats | ${formatCounts(types)} |
| Authority | ${formatCounts(authorities)} |
| Document roles | ${formatCounts(roles)} |

## Source families

| Family | Endpoints |
|---|---:|
${Object.entries(families).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `| ${key} | ${value} |`).join("\n")}

## Methodological cautions

- React still dominates endpoint count because its official documentation is split across many pages. Final experiments must report chunk distribution by language and may need stratified sampling or per-language metrics.
- Working drafts and living manuals are valid research sources only when the acquired bytes are frozen by hash and the document status is shown in the thesis.
- PDF preference does not override authority: official HTML remains preferable when the publisher identifies it as normative or no current PDF is distributed.
- Corpus size alone does not establish quality. Golden-set coverage and evidence diversity must grow with the corpus.

## Metadata warnings

${warnings.length ? warnings.map((warning) => `- ${warning}`).join("\n") : "No missing required metadata detected."}
`;
}

function count(sources: AuditedSource[], key: (source: AuditedSource) => string) {
  return sources.reduce<Record<string, number>>((result, source) => {
    const value = key(source);
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function check(name: string, actual: number, target?: number) {
  return { name, actual, target, status: target === undefined ? "not-configured" : actual >= target ? "pass" : "fail" };
}

function checkMaximum(name: string, actual: number, target?: number) {
  return { name, actual, target, status: target === undefined ? "not-configured" : actual <= target ? "pass" : "fail" };
}

function formatCounts(values: Record<string, number>) {
  return Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}: ${value}`).join("; ");
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function inferType(url?: string): "pdf" | "html" | "markdown" {
  if (url?.toLowerCase().endsWith(".pdf")) return "pdf";
  if (url?.toLowerCase().endsWith(".md")) return "markdown";
  return "html";
}

function parseArgs(args: string[]) {
  const outputIndex = args.findIndex((arg) => arg === "--output");
  const manifests = args.filter((arg, index) => args[index - 1] === "--manifest");
  return {
    manifests: manifests.length ? manifests : ["docs/corpus/react-learn.json", "docs/corpus/programming-foundation.json"],
    output: outputIndex >= 0 ? args[outputIndex + 1] : "docs/corpus/coverage-audit",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
