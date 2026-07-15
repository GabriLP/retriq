import fs from "node:fs/promises";
import path from "node:path";

import type { ExperimentRun } from "../src/lib/rag/experiment-types";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runFiles = await findRunFiles(path.resolve(options.root));
  const allRuns = (
    await Promise.all(runFiles.map(async (file) => JSON.parse(await fs.readFile(file, "utf8")) as ExperimentRun))
  ).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (!allRuns.length) throw new Error(`No experiment run.json files found under ${options.root}.`);
  const latestByExperiment = new Map<string, ExperimentRun>();
  for (const run of allRuns) latestByExperiment.set(run.experimentId, run);
  const runs = [...latestByExperiment.values()].sort((left, right) => left.experimentId.localeCompare(right.experimentId));

  const outputBase = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputBase), { recursive: true });
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(runs));
  await fs.writeFile(`${outputBase}.csv`, renderCsv(runs));
  console.log(`Compared the latest run for ${runs.length} experiment(s); retained ${allRuns.length} raw run(s).`);
  console.log(`Wrote ${outputBase}.md`);
  console.log(`Wrote ${outputBase}.csv`);
}

async function findRunFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findRunFiles(fullPath);
      return Promise.resolve(entry.name === "run.json" ? [fullPath] : []);
    }),
  );
  return files.flat();
}

function renderMarkdown(runs: ExperimentRun[]) {
  const corpusHashes = new Set(runs.map((run) => run.corpusSnapshot?.sha256).filter(Boolean));
  const warnings = [
    runs.some((run) => run.code.dirty)
      ? "At least one run used a dirty workspace. Re-run from a clean commit for thesis measurements."
      : undefined,
    runs.some((run) => !run.corpusSnapshot?.sha256)
      ? "At least one legacy run does not record the loaded corpus snapshot hash."
      : undefined,
    corpusHashes.size > 1
      ? "Runs loaded different corpus snapshots and must not be compared as a controlled experiment."
      : undefined,
  ].filter(Boolean);
  const preliminary = warnings.length ? `\n> **Preliminary comparison:** ${warnings.join(" ")}\n` : "";
  const rows = runs.map((run) => {
    const stats = run.statistics;
    return `| ${run.experimentId} | ${run.runId} | ${run.status} | ${run.configuration.chunking.targetWords} | ${run.configuration.chunking.overlapWords} | ${stats?.chunkCount ?? "-"} | ${stats?.averageChunkWords ?? "-"} | ${stats?.chunkWordDistribution?.p50 ?? "-"} | ${stats?.chunkWordDistribution?.p90 ?? "-"} | ${stats?.chunkWordDistribution?.belowConfiguredMinimum ?? "-"} | ${run.timingsMs?.total ?? "-"} | ${run.corpusSnapshot?.sha256.slice(0, 8) ?? "-"} | ${run.configHash.slice(0, 8)} |`;
  });
  return `# Experiment comparison

Generated: ${new Date().toISOString()}
${preliminary}

| Experiment | Run | Status | Target words | Overlap | Chunks | Average words | P50 | P90 | Below minimum | Preparation ms | Corpus hash | Config hash |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
${rows.join("\n")}

## Interpretation notes

- Compare retrieval/generation metrics only after runs use the same corpus snapshot and golden set.
- A dirty workspace is recorded in each run and should be avoided for final thesis measurements.
- Preparation metrics describe corpus segmentation; they do not measure retrieval quality by themselves.
- Chunk percentiles and below-minimum counts expose when source-section boundaries dominate the configured target size.
`;
}

function renderCsv(runs: ExperimentRun[]) {
  const header = [
    "experiment_id",
    "run_id",
    "status",
    "config_hash",
    "corpus_snapshot_hash",
    "git_commit",
    "git_dirty",
    "target_words",
    "min_words",
    "overlap_words",
    "document_count",
    "source_count",
    "chunk_count",
    "word_count",
    "average_chunk_words",
    "chunk_words_minimum",
    "chunk_words_p50",
    "chunk_words_p90",
    "chunk_words_p95",
    "chunk_words_maximum",
    "chunks_below_configured_minimum",
    "chunks_at_or_above_target",
    "load_ms",
    "chunking_ms",
    "total_ms",
  ];
  const rows = runs.map((run) => [
    run.experimentId,
    run.runId,
    run.status,
    run.configHash,
    run.corpusSnapshot?.sha256 ?? "",
    run.code.gitCommit,
    run.code.dirty,
    run.configuration.chunking.targetWords,
    run.configuration.chunking.minWords,
    run.configuration.chunking.overlapWords,
    run.statistics?.documentCount ?? "",
    run.statistics?.sourceCount ?? "",
    run.statistics?.chunkCount ?? "",
    run.statistics?.wordCount ?? "",
    run.statistics?.averageChunkWords ?? "",
    run.statistics?.chunkWordDistribution?.minimum ?? "",
    run.statistics?.chunkWordDistribution?.p50 ?? "",
    run.statistics?.chunkWordDistribution?.p90 ?? "",
    run.statistics?.chunkWordDistribution?.p95 ?? "",
    run.statistics?.chunkWordDistribution?.maximum ?? "",
    run.statistics?.chunkWordDistribution?.belowConfiguredMinimum ?? "",
    run.statistics?.chunkWordDistribution?.atOrAboveTarget ?? "",
    run.timingsMs?.loadDocuments ?? "",
    run.timingsMs?.chunking ?? "",
    run.timingsMs?.total ?? "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function csvCell(value: unknown) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseArgs(args: string[]) {
  const rootIndex = args.findIndex((arg) => arg === "--root");
  const outputIndex = args.findIndex((arg) => arg === "--output");
  return {
    root: rootIndex >= 0 ? args[rootIndex + 1] : path.join("data", "experiments"),
    output:
      outputIndex >= 0 ? args[outputIndex + 1] : path.join("docs", "experiment-results", "comparison"),
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
