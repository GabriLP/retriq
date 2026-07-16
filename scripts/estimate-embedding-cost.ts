import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

import { ragConfig } from "../src/lib/rag/config";
import {
  defaultEmbeddingCachePath,
  inspectEmbeddingCache,
  type EmbeddingCachePlan,
} from "../src/lib/rag/embedding-cache";
import { formatProviderEmbeddingInput, type EmbeddingProvider } from "../src/lib/rag/embedding-providers";
import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, validateGoldenSet, validateGoldenSetSplit, type GoldenCaseStatus, type GoldenSplitName } from "../src/lib/rag/golden-set";
import { matchesEvidence } from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk } from "../src/lib/rag/types";

type Estimate = {
  schemaVersion: 1;
  estimateId: string;
  createdAt: string;
  parentRunId: string;
  experimentId: string;
  inputHashes: { config: string; chunks: string; goldenSet: string; splitManifest?: string };
  configuration: {
    provider: string;
    model: string;
    cachePath: string;
    priceUsdPerMillionTokens: number | null;
    priceObservedAt: string | null;
    priceSourceUrl: string | null;
    requestMode: "standard" | "batch";
    batchSize: number;
    outputDimensionality: number | null;
    split: GoldenSplitName | null;
  };
  caseSelection: { selected: number; excludedDraftOrStatus: number; excludedOutsideCorpus: number };
  documents: EmbeddingCachePlan;
  queries: EmbeddingCachePlan;
  total: {
    requestedTexts: number;
    uniqueTexts: number;
    cacheHits: number;
    cacheMisses: number;
    avoidedApiInputs: number;
    estimatedProviderRequests: number;
    estimatedApiTokens: number;
    estimatedAvoidedTokens: number;
    estimatedApiCostUsd: number | null;
    estimatedAvoidedCostUsd: number | null;
  };
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const runDirectory = path.resolve(readRunPath(process.argv.slice(2)));
  const runRaw = await fs.readFile(path.join(runDirectory, "run.json"), "utf8");
  const configRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const run = JSON.parse(runRaw) as ExperimentRun;
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (run.status !== "prepared") throw new Error(`Parent run ${run.runId} is not prepared.`);
  if (!["google", "openai", "voyage"].includes(config.embedding.provider)) throw new Error(`Embedding provider '${config.embedding.provider}' is not implemented.`);
  if (!config.evaluation.goldenSet) throw new Error("Experiment config must define evaluation.goldenSet.");

  const goldenRaw = await fs.readFile(path.resolve(config.evaluation.goldenSet), "utf8");
  const goldenSet = await loadGoldenSet(config.evaluation.goldenSet);
  const validation = await validateGoldenSet(goldenSet);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  const allowedStatuses = (config.evaluation.caseStatuses ?? ["human-approved"]) as GoldenCaseStatus[];
  let splitRaw: string | undefined;
  let splitSelected = goldenSet.cases;
  if (config.evaluation.splitManifest || config.evaluation.split) {
    if (!config.evaluation.splitManifest || !config.evaluation.split) throw new Error("evaluation.splitManifest and evaluation.split must be configured together.");
    splitRaw = await fs.readFile(path.resolve(config.evaluation.splitManifest), "utf8");
    const split = await loadGoldenSetSplit(config.evaluation.splitManifest);
    const splitValidation = validateGoldenSetSplit(goldenSet, split);
    if (splitValidation.errors.length) throw new Error(splitValidation.errors.join("\n"));
    splitSelected = selectGoldenSplit(goldenSet, split, config.evaluation.split);
  }
  const statusSelected = splitSelected.filter((testCase) => allowedStatuses.includes(testCase.status));
  const selectedCases = statusSelected.filter(
    (testCase) =>
      testCase.answerability === "unanswerable" ||
      testCase.evidence.some((evidence) => chunks.some((chunk) => matchesEvidence(chunk, evidence))),
  );
  const sharedOptions = {
    cachePath: defaultEmbeddingCachePath,
    provider: config.embedding.provider,
    model: config.embedding.model,
    charactersPerToken: ragConfig.embeddingCharactersPerToken,
    priceUsdPerMillionTokens:
      config.embedding.pricing?.usdPerMillionInputTokens ?? ragConfig.embeddingPriceUsdPerMillionTokens,
    outputDimensionality: config.embedding.outputDimensionality,
  };
  const documentTask = config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT";
  const queryTask = config.embedding.queryTask ?? "QUESTION_ANSWERING";
  const documentTexts = chunks.map((chunk) =>
    formatProviderEmbeddingInput(`${chunk.section}\n${chunk.content}`, {
      provider: config.embedding.provider as EmbeddingProvider,
      model: config.embedding.model,
      taskType: documentTask,
      title: chunk.title,
    }),
  );
  const queryTexts = selectedCases.map((testCase) =>
    formatProviderEmbeddingInput(testCase.question, {
      provider: config.embedding.provider as EmbeddingProvider,
      model: config.embedding.model,
      taskType: queryTask,
    }),
  );
  const [documents, queries] = await Promise.all([
    inspectEmbeddingCache(documentTexts, { ...sharedOptions, taskType: documentTask }),
    inspectEmbeddingCache(queryTexts, { ...sharedOptions, taskType: queryTask }),
  ]);
  const createdAt = new Date().toISOString();
  const estimateId = `${createdAt.replace(/[-:.TZ]/g, "").slice(0, 17)}-${slug(config.embedding.model)}`;
  const pricesKnown = documents.estimatedApiCostUsd !== null && queries.estimatedApiCostUsd !== null;
  const estimate: Estimate = {
    schemaVersion: 1,
    estimateId,
    createdAt,
    parentRunId: run.runId,
    experimentId: run.experimentId,
    inputHashes: { config: sha256(configRaw), chunks: sha256(chunksRaw), goldenSet: sha256(goldenRaw), ...(splitRaw ? { splitManifest: sha256(splitRaw) } : {}) },
    configuration: {
      provider: config.embedding.provider,
      model: config.embedding.model,
      cachePath: path.resolve(defaultEmbeddingCachePath),
      priceUsdPerMillionTokens: sharedOptions.priceUsdPerMillionTokens ?? null,
      priceObservedAt: config.embedding.pricing?.observedAt ?? null,
      priceSourceUrl: config.embedding.pricing?.sourceUrl ?? null,
      requestMode: config.embedding.pricing?.requestMode ?? "standard",
      batchSize: config.embedding.batchSize ?? 32,
      outputDimensionality: config.embedding.outputDimensionality ?? null,
      split: config.evaluation.split ?? null,
    },
    caseSelection: {
      selected: selectedCases.length,
      excludedDraftOrStatus: splitSelected.length - statusSelected.length,
      excludedOutsideCorpus: statusSelected.length - selectedCases.length,
    },
    documents,
    queries,
    total: {
      requestedTexts: documents.requestedTexts + queries.requestedTexts,
      uniqueTexts: documents.uniqueTexts + queries.uniqueTexts,
      cacheHits: documents.cacheHits + queries.cacheHits,
      cacheMisses: documents.cacheMisses + queries.cacheMisses,
      avoidedApiInputs: documents.avoidedApiInputs + queries.avoidedApiInputs,
      estimatedProviderRequests:
        Math.ceil(documents.cacheMisses / (config.embedding.batchSize ?? 32)) +
        Math.ceil(queries.cacheMisses / (config.embedding.batchSize ?? 32)),
      estimatedApiTokens: documents.estimatedApiTokens + queries.estimatedApiTokens,
      estimatedAvoidedTokens: documents.estimatedAvoidedTokens + queries.estimatedAvoidedTokens,
      estimatedApiCostUsd: pricesKnown
        ? (documents.estimatedApiCostUsd ?? 0) + (queries.estimatedApiCostUsd ?? 0)
        : null,
      estimatedAvoidedCostUsd: pricesKnown
        ? (documents.estimatedAvoidedCostUsd ?? 0) + (queries.estimatedAvoidedCostUsd ?? 0)
        : null,
    },
  };

  const outputDirectory = path.join(runDirectory, "embedding-estimates", estimateId);
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, "estimate.json"), JSON.stringify(estimate, null, 2));
  await fs.writeFile(path.join(outputDirectory, "summary.md"), renderSummary(estimate));
  await fs.appendFile(path.join(runDirectory, "embedding-estimates", "index.jsonl"), `${JSON.stringify(estimate)}\n`);
  console.log(`ESTIMATED ${run.experimentId}/${run.runId}/${estimateId}`);
  console.log(`Embedding inputs after cache: ${estimate.total.cacheMisses}`);
  console.log(`Estimated provider requests: ${estimate.total.estimatedProviderRequests}`);
  console.log(`Estimated API tokens: ${estimate.total.estimatedApiTokens}`);
  console.log(`Estimated API cost (USD): ${formatCost(estimate.total.estimatedApiCostUsd)}`);
  console.log(`Wrote ${outputDirectory}`);
}

function renderSummary(estimate: Estimate) {
  return `# Embedding estimate ${estimate.estimateId}

- Experiment: \`${estimate.experimentId}\`
- Parent run: \`${estimate.parentRunId}\`
- Provider/model: ${estimate.configuration.provider} / ${estimate.configuration.model}
- Cache: \`${estimate.configuration.cachePath}\`
- Price assumption: ${estimate.configuration.priceUsdPerMillionTokens === null ? "not configured" : `$${estimate.configuration.priceUsdPerMillionTokens} per million input tokens`}
- Price source/date: ${estimate.configuration.priceSourceUrl ?? "not recorded"} (${estimate.configuration.priceObservedAt ?? "date not recorded"})
- Output dimensions: ${estimate.configuration.outputDimensionality ?? "provider default"}
- Dataset split: ${estimate.configuration.split ?? "all eligible cases"}
- Request mode/batch size: ${estimate.configuration.requestMode} / ${estimate.configuration.batchSize} inputs

| Input group | Requested | Unique | Cache hits | API inputs | Avoided inputs | Estimated API tokens | Estimated cost (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Documents | ${estimate.documents.requestedTexts} | ${estimate.documents.uniqueTexts} | ${estimate.documents.cacheHits} | ${estimate.documents.cacheMisses} | ${estimate.documents.avoidedApiInputs} | ${estimate.documents.estimatedApiTokens} | ${formatCost(estimate.documents.estimatedApiCostUsd)} |
| Queries | ${estimate.queries.requestedTexts} | ${estimate.queries.uniqueTexts} | ${estimate.queries.cacheHits} | ${estimate.queries.cacheMisses} | ${estimate.queries.avoidedApiInputs} | ${estimate.queries.estimatedApiTokens} | ${formatCost(estimate.queries.estimatedApiCostUsd)} |
| **Total** | **${estimate.total.requestedTexts}** | **${estimate.total.uniqueTexts}** | **${estimate.total.cacheHits}** | **${estimate.total.cacheMisses}** | **${estimate.total.avoidedApiInputs}** | **${estimate.total.estimatedApiTokens}** | **${formatCost(estimate.total.estimatedApiCostUsd)}** |

Estimated provider requests after synchronous batching: **${estimate.total.estimatedProviderRequests}**.

Token counts use the declared character-to-token ratio and are planning estimates, not provider billing data. No embedding API was called by this command.
`;
}

function formatCost(value: number | null) {
  return value === null ? "not available" : value.toFixed(6);
}

function readRunPath(args: string[]) {
  const index = args.findIndex((arg) => arg === "--run" || arg === "-r");
  const runPath = index >= 0 ? args[index + 1] : undefined;
  if (!runPath) throw new Error("Usage: tsx scripts/estimate-embedding-cost.ts --run <experiment-run-directory>");
  return runPath;
}

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
