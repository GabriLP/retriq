import fs from "node:fs/promises";
import path from "node:path";

type Exception = { code: string; pageNumber: number; reason: string; verifiedAt: string; verificationMethod: string };
type Source = { id: string; type?: string; title?: string; qualityExceptions?: Exception[] };
type Manifest = { parsedBasePath?: string; sources: Array<string | Source> };
type Quality = {
  status: "pass" | "review";
  partial: boolean;
  pageRange?: [number, number];
  pageCount: number;
  wordCount: number;
  elapsedMs: number;
  issues: Array<{ code: string; pageNumber: number }>;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifest);
  const manifestDirectory = path.dirname(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
  const parsedRoot = path.resolve(manifestDirectory, manifest.parsedBasePath ?? "../../data/parsed/programming-foundation");
  const rows = [];
  for (const source of manifest.sources) {
    if (typeof source === "string" || source.type !== "pdf") continue;
    const quality = JSON.parse(await fs.readFile(path.join(parsedRoot, source.id, "quality.json"), "utf8")) as Quality;
    const unresolved = quality.issues.filter(
      (issue) => !source.qualityExceptions?.some((exception) => exception.code === issue.code && exception.pageNumber === issue.pageNumber),
    );
    rows.push({
      id: source.id,
      title: source.title,
      rawStatus: quality.status,
      effectiveStatus: unresolved.length ? "review" : "pass",
      pageRange: quality.pageRange,
      pageCount: quality.pageCount,
      wordCount: quality.wordCount,
      elapsedMs: quality.elapsedMs,
      issues: quality.issues,
      acceptedExceptions: quality.issues.filter((issue) => !unresolved.includes(issue)),
      unresolvedIssues: unresolved,
      exceptionRecords: source.qualityExceptions ?? [],
    });
  }
  const outputBase = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputBase), { recursive: true });
  await fs.writeFile(`${outputBase}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(rows));
  console.log(`Reported ${rows.length} PDF smoke results; ${rows.filter((row) => row.effectiveStatus === "review").length} unresolved review(s).`);
}

function renderMarkdown(rows: Array<{
  id: string;
  rawStatus: string;
  effectiveStatus: string;
  pageRange?: [number, number];
  pageCount: number;
  wordCount: number;
  elapsedMs: number;
  issues: Array<{ code: string; pageNumber: number }>;
  acceptedExceptions: Array<{ code: string; pageNumber: number }>;
  unresolvedIssues: Array<{ code: string; pageNumber: number }>;
}>) {
  return `# PDF parsing progress report

Generated: ${new Date().toISOString()}

> Partial rows are page-range smoke tests, not approval of complete documents. Full rows have processed every page but still require all reported issues to be resolved or explicitly verified.

- PDF documents: **${rows.length}**
- Complete documents: **${rows.filter((row) => !row.pageRange).length}**
- Partial smoke tests: **${rows.filter((row) => row.pageRange).length}**
- Raw pass: **${rows.filter((row) => row.rawStatus === "pass").length}**
- Raw review: **${rows.filter((row) => row.rawStatus === "review").length}**
- Effective pass after verified exceptions: **${rows.filter((row) => row.effectiveStatus === "pass").length}**
- Unresolved review: **${rows.filter((row) => row.effectiveStatus === "review").length}**

| Source | Scope | Pages | Words | Raw | Effective | Issues | Accepted exceptions | Time ms |
|---|---|---:|---:|---|---|---|---|---:|
${rows.map((row) => `| ${row.id} | ${row.pageRange ? "partial" : "full"} | ${row.pageRange?.join("-") ?? row.pageCount} | ${row.wordCount} | ${row.rawStatus} | ${row.effectiveStatus} | ${formatIssues(row.issues)} | ${formatIssues(row.acceptedExceptions)} | ${row.elapsedMs} |`).join("\n")}

## Decision rule

- An exception is exact-match only: source, page number, and issue code.
- Every exception requires a reason, verification date, and verification method in the corpus manifest.
- A new issue or the same issue on another page remains blocking under the corpus fail policy.
`;
}

function formatIssues(issues: Array<{ code: string; pageNumber: number }>) {
  return issues.length ? issues.map((issue) => `p${issue.pageNumber}:${issue.code}`).join("; ") : "—";
}

function parseArgs(args: string[]) {
  const manifestIndex = args.findIndex((arg) => arg === "--manifest");
  const outputIndex = args.findIndex((arg) => arg === "--output");
  return {
    manifest: manifestIndex >= 0 ? args[manifestIndex + 1] : "docs/corpus/programming-foundation.json",
    output: outputIndex >= 0 ? args[outputIndex + 1] : "docs/corpus/pdf-parsing-progress",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
