import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { inspectBenchmarkSuite, type BenchmarkSuite } from "../src/lib/rag/benchmark-suite";
import type { ExperimentRun } from "../src/lib/rag/experiment-types";

type SuitePreparation = {
  schemaVersion: 1;
  suiteId: string;
  attemptId: string;
  createdAt: string;
  completedAt: string;
  status: "comparable" | "invalid";
  protocolHash: string;
  corpusSnapshotHash?: string;
  runs: Array<{
    experimentId: string;
    runId: string;
    runPath: string;
    configHash: string;
    corpusSnapshotHash?: string;
  }>;
  error?: string;
};

async function main() {
  const suitePath = path.resolve(readSuitePath(process.argv.slice(2)));
  const inspection = await inspectBenchmarkSuite(suitePath);
  if (!inspection.valid) throw new Error(inspection.errors.join("\n"));
  if (!inspection.readiness.exploratory.ready) {
    throw new Error("The benchmark is not ready for exploratory runs. Regenerate the readiness report for details.");
  }
  const suite = JSON.parse(await fs.readFile(suitePath, "utf8")) as BenchmarkSuite;
  const suiteDirectory = path.dirname(suitePath);
  const createdAt = new Date().toISOString();
  const attemptId = createdAt.replace(/[-:.TZ]/g, "").slice(0, 17);
  const attemptDirectory = path.join("data", "experiments", "benchmark-suites", suite.id, attemptId);
  const attempt: SuitePreparation = {
    schemaVersion: 1,
    suiteId: suite.id,
    attemptId,
    createdAt,
    completedAt: createdAt,
    status: "invalid",
    protocolHash: inspection.protocolHash,
    runs: [],
  };

  await fs.mkdir(attemptDirectory, { recursive: true });
  try {
    for (const configPath of suite.experimentConfigs) {
      const absolutePath = path.resolve(suiteDirectory, configPath);
      const config = JSON.parse(await fs.readFile(absolutePath, "utf8")) as { id: string };
      console.log(`Preparing ${path.relative(process.cwd(), absolutePath)}`);
      const result = spawnSync(
        process.execPath,
        [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/prepare-experiment.ts", "--config", absolutePath],
        { cwd: process.cwd(), encoding: "utf8", stdio: "inherit", windowsHide: true },
      );
      if (result.status !== 0) throw new Error(`Experiment preparation failed for ${configPath}.`);
      const located = await findLatestRun(config.id, createdAt);
      attempt.runs.push({
        experimentId: located.run.experimentId,
        runId: located.run.runId,
        runPath: projectPath(located.path),
        configHash: located.run.configHash,
        corpusSnapshotHash: located.run.corpusSnapshot?.sha256,
      });
    }

    const snapshotHashes = new Set(attempt.runs.map((run) => run.corpusSnapshotHash).filter(Boolean));
    if (attempt.runs.some((run) => !run.corpusSnapshotHash)) {
      throw new Error("At least one prepared run does not record a loaded corpus snapshot hash.");
    }
    if (snapshotHashes.size !== 1) {
      throw new Error("Prepared runs loaded different corpus snapshots and are invalid for controlled comparison.");
    }
    attempt.corpusSnapshotHash = [...snapshotHashes][0];
    attempt.status = "comparable";
  } catch (error) {
    attempt.error = error instanceof Error ? error.message : "Unknown benchmark preparation failure.";
  }

  attempt.completedAt = new Date().toISOString();
  await fs.writeFile(path.join(attemptDirectory, "suite-attempt.json"), `${JSON.stringify(attempt, null, 2)}\n`);
  console.log(`${attempt.status.toUpperCase()} ${suite.id}/${attemptId}`);
  console.log(`Wrote ${projectPath(attemptDirectory)}`);
  if (attempt.error) throw new Error(attempt.error);
}

async function findLatestRun(experimentId: string, notBefore: string) {
  const directory = path.resolve("data", "experiments", experimentId);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runPath = path.join(directory, entry.name, "run.json");
        const run = JSON.parse(await fs.readFile(runPath, "utf8")) as ExperimentRun;
        return { path: path.dirname(runPath), run };
      }),
  );
  const selected = candidates
    .filter((candidate) => candidate.run.createdAt >= notBefore)
    .sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))[0];
  if (!selected) throw new Error(`Could not locate the prepared run for '${experimentId}'.`);
  return selected;
}

function readSuitePath(args: string[]) {
  const index = args.findIndex((arg) => arg === "--suite" || arg === "-s");
  return index >= 0 ? args[index + 1] : "docs/experiments/common-programming-chunk-size.v1.json";
}

function projectPath(filePath: string) {
  return path.relative(process.cwd(), path.resolve(filePath)).replaceAll(path.sep, "/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
