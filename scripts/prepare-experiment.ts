import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { createChunksFromDocuments } from "../src/lib/rag/chunking";
import { summarizeChunkWords } from "../src/lib/rag/chunk-statistics";
import { loadCorpusManifests } from "../src/lib/rag/corpus-manifest";
import { loadSources } from "../src/lib/rag/document-loaders";
import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";

async function main() {
  const startedAt = performance.now();
  const configPath = path.resolve(readConfigPath(process.argv.slice(2)));
  const configRaw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(configRaw) as ExperimentConfig;
  validateConfig(config);

  const configHash = sha256(configRaw);
  const createdAt = new Date().toISOString();
  const runId = `${createdAt.replace(/[-:.TZ]/g, "").slice(0, 17)}-${configHash.slice(0, 8)}`;
  const runDirectory = path.join(process.cwd(), "data", "experiments", config.id, runId);
  const corpusManifestHashes = await Promise.all(
    config.corpus.manifests.map(async (manifestPath) => {
      const absolutePath = path.resolve(manifestPath);
      return { path: absolutePath, sha256: sha256(await fs.readFile(absolutePath)) };
    }),
  );
  const evaluationDatasetHashes = config.evaluation.goldenSet
    ? [
        {
          path: path.resolve(config.evaluation.goldenSet),
          sha256: sha256(await fs.readFile(path.resolve(config.evaluation.goldenSet))),
        },
        ...(config.evaluation.splitManifest
          ? [{ path: path.resolve(config.evaluation.splitManifest), sha256: sha256(await fs.readFile(path.resolve(config.evaluation.splitManifest))) }]
          : []),
      ]
    : [];

  const provenancePaths = [
    "src",
    "scripts",
    "package.json",
    "package-lock.json",
    "docs/corpus",
    "docs/experiments",
    "docs/evaluation",
  ];
  const gitStatus = runCommand("git", ["status", "--porcelain", "--", ...provenancePaths]);
  const gitDiff = runCommand("git", ["diff", "--binary", "--", ...provenancePaths]);
  const sourceFiles = await fingerprintSourceTree();
  const run: ExperimentRun = {
    schemaVersion: 1,
    runId,
    experimentId: config.id,
    status: "failed",
    createdAt,
    completedAt: createdAt,
    configHash,
    configPath,
    corpusManifestHashes,
    evaluationDatasetHashes,
    code: {
      gitCommit: runCommand("git", ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitStatus),
      gitDiffHash: sha256(gitDiff),
      sourceTreeHash: sha256(sourceFiles.map((file) => `${file.path}\0${file.sha256}`).join("\n")),
      changedFiles: gitStatus.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3)),
    },
    environment: {
      node: process.version,
      platform: os.platform(),
      architecture: os.arch(),
      python: runCommand(process.env.RETRIQ_DOCLING_PYTHON ?? "python", ["--version"]),
      docling: runCommand(process.env.RETRIQ_DOCLING_PYTHON ?? "python", [
        "-c",
        "import importlib.metadata; print(importlib.metadata.version('docling'))",
      ]),
    },
    configuration: config,
  };

  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "config.snapshot.json"), JSON.stringify(config, null, 2));
  await fs.writeFile(
    path.join(runDirectory, "code-provenance.json"),
    JSON.stringify({ ...run.code, files: sourceFiles }, null, 2),
  );
  await fs.writeFile(path.join(runDirectory, "workspace.patch"), gitDiff);

  let failure: unknown;
  try {
    const manifestOptions = await loadCorpusManifests(config.corpus.manifests);
    const loadStartedAt = performance.now();
    const documents = await loadSources(manifestOptions.sources, {
      baseUrl: manifestOptions.baseUrl,
      sourceMetadataByInput: manifestOptions.sourceMetadataByInput,
    });
    const loadDocuments = Math.round(performance.now() - loadStartedAt);
    run.corpusSnapshot = createCorpusSnapshot(documents);

    const chunkStartedAt = performance.now();
    const chunks = createChunksFromDocuments(documents, config.chunking);
    const chunking = Math.round(performance.now() - chunkStartedAt);
    const wordCount = chunks.reduce((total, chunk) => total + chunk.wordCount, 0);

    run.status = "prepared";
    run.statistics = {
      documentCount: documents.length,
      sourceCount: new Set(documents.map((document) => document.sourceUrl)).size,
      chunkCount: chunks.length,
      wordCount,
      averageChunkWords: Number((wordCount / Math.max(chunks.length, 1)).toFixed(2)),
      chunkWordDistribution: summarizeChunkWords(
        chunks.map((chunk) => chunk.wordCount),
        config.chunking.minWords,
        config.chunking.targetWords,
      ),
      languages: countValues(documents.map((document) => document.language ?? "unspecified")),
      sourceTypes: countValues(documents.map((document) => document.sourceType ?? "unspecified")),
    };
    run.timingsMs = {
      loadDocuments,
      chunking,
      total: Math.round(performance.now() - startedAt),
    };
    await fs.writeFile(path.join(runDirectory, "chunks.json"), JSON.stringify(chunks, null, 2));
  } catch (error) {
    failure = error;
    run.error = error instanceof Error ? error.message : "Unknown experiment preparation failure.";
  }

  run.completedAt = new Date().toISOString();
  await fs.writeFile(path.join(runDirectory, "run.json"), JSON.stringify(run, null, 2));
  await fs.writeFile(path.join(runDirectory, "summary.md"), renderSummary(run));
  await fs.mkdir(path.join(process.cwd(), "data", "experiments"), { recursive: true });
  await fs.appendFile(path.join(process.cwd(), "data", "experiments", "index.jsonl"), `${JSON.stringify(run)}\n`);

  console.log(`${run.status.toUpperCase()} ${config.id}/${runId}`);
  console.log(`Wrote ${runDirectory}`);
  if (failure) throw failure;
}

function validateConfig(config: ExperimentConfig) {
  if (config.schemaVersion !== 1) throw new Error("Experiment config schemaVersion must be 1.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.id)) throw new Error("Experiment id must use lowercase kebab-case.");
  if (!config.title || !config.hypothesis) throw new Error("Experiment title and hypothesis are required.");
  if (!Array.isArray(config.corpus?.manifests) || !config.corpus.manifests.length) {
    throw new Error("Experiment corpus.manifests must not be empty.");
  }
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function createCorpusSnapshot(
  documents: Array<{
    sourceId?: string;
    sourceUrl: string;
    title: string;
    section: string;
    content: string;
    pageStart?: number;
    pageEnd?: number;
  }>,
) {
  const bySource = new Map<string, typeof documents>();
  for (const document of documents) {
    const key = `${document.sourceId ?? ""}\0${document.sourceUrl}`;
    const group = bySource.get(key) ?? [];
    group.push(document);
    bySource.set(key, group);
  }
  const sources = [...bySource.values()]
    .map((sourceDocuments) => {
      const first = sourceDocuments[0];
      const canonical = sourceDocuments
        .map((document) => ({
          title: document.title,
          section: document.section,
          content: document.content,
          pageStart: document.pageStart,
          pageEnd: document.pageEnd,
        }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      return {
        sourceId: first.sourceId,
        sourceUrl: first.sourceUrl,
        sha256: sha256(JSON.stringify(canonical)),
      };
    })
    .sort((left, right) =>
      `${left.sourceId ?? ""}\0${left.sourceUrl}`.localeCompare(`${right.sourceId ?? ""}\0${right.sourceUrl}`),
    );
  return {
    sha256: sha256(sources.map((source) => `${source.sourceId ?? ""}\0${source.sourceUrl}\0${source.sha256}`).join("\n")),
    documentCount: documents.length,
    sources,
  };
}

function renderSummary(run: ExperimentRun) {
  const stats = run.statistics;
  return `# ${run.configuration.title}

- Run ID: \`${run.runId}\`
- Status: **${run.status}**
- Hypothesis: ${run.configuration.hypothesis}
- Config hash: \`${run.configHash}\`
- Git commit: \`${run.code.gitCommit}\`${run.code.dirty ? " (dirty workspace)" : ""}
- Created: ${run.createdAt}

## Configuration

| Component | Value |
|---|---|
| Corpus | ${run.configuration.corpus.manifests.join(", ")} |
| Loaded corpus snapshot | ${run.corpusSnapshot?.sha256 ?? "Not available"} |
| Chunking | ${run.configuration.chunking.strategy}: target ${run.configuration.chunking.targetWords}, min ${run.configuration.chunking.minWords}, overlap ${run.configuration.chunking.overlapWords} |
| Embedding | ${run.configuration.embedding.provider} / ${run.configuration.embedding.model} |
| Retrieval | ${run.configuration.retrieval.strategy}, top-k ${run.configuration.retrieval.topK}, min score ${run.configuration.retrieval.minScore} |
| Generator | ${run.configuration.generation.provider} / ${run.configuration.generation.model} |
| Golden set | ${run.configuration.evaluation.goldenSet ?? "Not configured"} |
| Included review states | ${run.configuration.evaluation.caseStatuses?.join(", ") ?? "Not configured"} |
| Evaluation split | ${run.configuration.evaluation.split ?? "All eligible cases"} |

## Preparation results

| Documents | Sources | Chunks | Indexed words | Average words | P50 | P90 | Maximum | Below configured minimum | Load ms | Chunking ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ${stats?.documentCount ?? "—"} | ${stats?.sourceCount ?? "—"} | ${stats?.chunkCount ?? "—"} | ${stats?.wordCount ?? "—"} | ${stats?.averageChunkWords ?? "—"} | ${stats?.chunkWordDistribution?.p50 ?? "—"} | ${stats?.chunkWordDistribution?.p90 ?? "—"} | ${stats?.chunkWordDistribution?.maximum ?? "—"} | ${stats?.chunkWordDistribution?.belowConfiguredMinimum ?? "—"} | ${run.timingsMs?.loadDocuments ?? "—"} | ${run.timingsMs?.chunking ?? "—"} |

${run.error ? `## Error\n\n${run.error}\n` : ""}`;
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

async function fingerprintSourceTree() {
  const output = runCommand("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "src",
    "scripts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.ts",
  ]);
  const files = output.split(/\r?\n/).filter(Boolean).sort();
  return Promise.all(
    files.map(async (filePath) => ({
      path: filePath.replaceAll("\\", "/"),
      sha256: sha256(await fs.readFile(path.resolve(filePath))),
    })),
  );
}

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readConfigPath(args: string[]) {
  const index = args.findIndex((arg) => arg === "--config" || arg === "-c");
  const configPath = index >= 0 ? args[index + 1] : undefined;
  if (!configPath) throw new Error("Usage: tsx scripts/prepare-experiment.ts --config <experiment.json>");
  return configPath;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
