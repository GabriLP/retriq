import fs from "node:fs/promises";
import path from "node:path";

import { inspectBenchmarkSuite, renderBenchmarkMarkdown } from "../src/lib/rag/benchmark-suite";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inspection = await inspectBenchmarkSuite(options.suite);
  if (options.write) {
    const suite = JSON.parse(await fs.readFile(path.resolve(options.suite), "utf8")) as { reportOutput?: string };
    if (!suite.reportOutput) throw new Error("Benchmark suite reportOutput is required when using --write.");
    const outputBase = path.resolve(suite.reportOutput);
    await fs.mkdir(path.dirname(outputBase), { recursive: true });
    await fs.writeFile(`${outputBase}.json`, `${JSON.stringify(inspection, null, 2)}\n`);
    await fs.writeFile(`${outputBase}.md`, renderBenchmarkMarkdown(inspection));
    console.log(`Wrote ${projectPath(outputBase)}.json and ${projectPath(outputBase)}.md`);
  }
  console.log(
    `${inspection.valid ? "VALID" : "INVALID"} ${inspection.suiteId}: ${inspection.experiments.length} experiments, protocol ${inspection.protocolHash.slice(0, 12)}`,
  );
  console.log(
    `Exploratory ready: ${inspection.readiness.exploratory.ready}; thesis ready: ${inspection.readiness.thesis.ready}; warnings: ${inspection.warnings.length}`,
  );
  if (inspection.errors.length) throw new Error(inspection.errors.join("\n"));
}

function parseArgs(args: string[]) {
  const suiteIndex = args.findIndex((arg) => arg === "--suite" || arg === "-s");
  return {
    suite: suiteIndex >= 0 ? args[suiteIndex + 1] : "docs/experiments/common-programming-chunk-size.v1.json",
    write: args.includes("--write"),
  };
}

function projectPath(filePath: string) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
