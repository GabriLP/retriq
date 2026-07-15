import fs from "node:fs/promises";
import path from "node:path";

import { inspectBenchmarkSuite, type BenchmarkSuite } from "../src/lib/rag/benchmark-suite";
import type { ExperimentRun } from "../src/lib/rag/experiment-types";

type SuiteAttempt = {
  suiteId: string;
  attemptId: string;
  status: "comparable" | "invalid";
  protocolHash: string;
  corpusSnapshotHash?: string;
  runs: Array<{ experimentId: string; runPath: string }>;
};

async function main() {
  const suitePath = path.resolve(readSuitePath(process.argv.slice(2)));
  const inspection = await inspectBenchmarkSuite(suitePath);
  if (!inspection.valid) throw new Error(inspection.errors.join("\n"));
  const suite = JSON.parse(await fs.readFile(suitePath, "utf8")) as BenchmarkSuite;
  if (!suite.preparationReportOutput) throw new Error("Benchmark suite preparationReportOutput is required.");
  const attempt = await loadLatestComparableAttempt(suite.id);
  if (attempt.protocolHash !== inspection.protocolHash) {
    throw new Error("Latest comparable preparation uses a different protocol hash. Prepare the current suite again.");
  }
  const runs = await Promise.all(
    attempt.runs.map(async (entry) => JSON.parse(await fs.readFile(path.join(entry.runPath, "run.json"), "utf8")) as ExperimentRun),
  );
  validateRuns(attempt, runs);

  const outputBase = path.resolve(suite.preparationReportOutput);
  await fs.mkdir(path.dirname(outputBase), { recursive: true });
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(attempt, runs));
  await fs.writeFile(`${outputBase}.csv`, renderCsv(attempt, runs));
  console.log(`Reported ${runs.length} comparable preparation run(s) from suite attempt ${attempt.attemptId}.`);
  console.log(`Wrote ${projectPath(outputBase)}.md and ${projectPath(outputBase)}.csv`);
}

async function loadLatestComparableAttempt(suiteId: string) {
  const directory = path.resolve("data", "experiments", "benchmark-suites", suiteId);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const attempts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name, "suite-attempt.json");
        return JSON.parse(await fs.readFile(filePath, "utf8")) as SuiteAttempt;
      }),
  );
  const selected = attempts
    .filter((attempt) => attempt.status === "comparable")
    .sort((left, right) => right.attemptId.localeCompare(left.attemptId))[0];
  if (!selected) throw new Error(`No comparable benchmark preparation found for '${suiteId}'.`);
  return selected;
}

function validateRuns(attempt: SuiteAttempt, runs: ExperimentRun[]) {
  if (runs.some((run) => run.status !== "prepared")) throw new Error("Every suite run must be prepared.");
  if (runs.some((run) => run.code.dirty)) throw new Error("Preparation report refuses runs from a dirty workspace.");
  if (runs.some((run) => run.corpusSnapshot?.sha256 !== attempt.corpusSnapshotHash)) {
    throw new Error("Suite run corpus hashes do not match the accepted suite attempt.");
  }
  if (runs.some((run) => !run.statistics?.chunkWordDistribution)) {
    throw new Error("Suite runs do not contain chunk-size distributions. Prepare the suite with the current runner.");
  }
}

function renderMarkdown(attempt: SuiteAttempt, runs: ExperimentRun[]) {
  const rows = [...runs]
    .sort((left, right) => left.configuration.chunking.targetWords - right.configuration.chunking.targetWords)
    .map((run) => {
      const stats = run.statistics!;
      const distribution = stats.chunkWordDistribution!;
      return `| ${run.experimentId} | ${run.configuration.chunking.targetWords} | ${run.configuration.chunking.minWords} | ${run.configuration.chunking.overlapWords} | ${stats.chunkCount} | ${stats.wordCount} | ${stats.averageChunkWords} | ${distribution.p50} | ${distribution.p90} | ${distribution.p95} | ${distribution.maximum} | ${distribution.belowConfiguredMinimum} | ${distribution.atOrAboveTarget} | ${run.timingsMs?.total ?? "-"} |`;
    });
  return `# Common chunk-size benchmark preparation

- Suite attempt: \`${attempt.attemptId}\`
- Protocol hash: \`${attempt.protocolHash}\`
- Loaded corpus hash: \`${attempt.corpusSnapshotHash}\`
- Status: **comparable**

| Experiment | Target | Minimum | Overlap | Chunks | Indexed words | Average | P50 | P90 | P95 | Maximum | Below minimum | At/above target | Preparation ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join("\n")}

## Interpretation

- These are corpus-preparation measurements, not retrieval-quality results.
- All candidates used the same loaded corpus snapshot and clean committed code.
- Short source sections are retained as standalone chunks, explaining the common below-minimum count.
- A single source block is not split by the word-window chunker, explaining maxima above every configured target.
- The baseline is retained for retrieval evaluation; no chunk-size choice is accepted until nDCG@k and guardrail metrics are measured on the same suite.
`;
}

function renderCsv(attempt: SuiteAttempt, runs: ExperimentRun[]) {
  const header = [
    "suite_attempt", "protocol_hash", "corpus_snapshot_hash", "experiment_id", "run_id", "git_commit",
    "config_hash", "target_words", "minimum_words", "overlap_words", "chunks", "indexed_words", "average_words",
    "minimum", "p50", "p90", "p95", "maximum", "below_configured_minimum", "at_or_above_target",
    "load_ms", "chunking_ms", "total_ms",
  ];
  const rows = runs.map((run) => {
    const stats = run.statistics!;
    const distribution = stats.chunkWordDistribution!;
    return [
      attempt.attemptId, attempt.protocolHash, attempt.corpusSnapshotHash ?? "", run.experimentId, run.runId,
      run.code.gitCommit, run.configHash, run.configuration.chunking.targetWords, run.configuration.chunking.minWords,
      run.configuration.chunking.overlapWords, stats.chunkCount, stats.wordCount, stats.averageChunkWords,
      distribution.minimum, distribution.p50, distribution.p90, distribution.p95, distribution.maximum,
      distribution.belowConfiguredMinimum, distribution.atOrAboveTarget, run.timingsMs?.loadDocuments ?? "",
      run.timingsMs?.chunking ?? "", run.timingsMs?.total ?? "",
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function csvCell(value: unknown) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function readSuitePath(args: string[]) {
  const index = args.findIndex((arg) => arg === "--suite" || arg === "-s");
  return index >= 0 ? args[index + 1] : "docs/experiments/common-programming-chunk-size.v1.json";
}

function projectPath(filePath: string) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
