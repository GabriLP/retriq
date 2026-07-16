import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nextEnv from "@next/env";

import type { ExperimentConfig, ExperimentRun } from "../src/lib/rag/experiment-types";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, validateGoldenSet, validateGoldenSetSplit, type GoldenCase } from "../src/lib/rag/golden-set";
import { filterChunksByQueryMetadata, type CompatibilityDecision } from "../src/lib/rag/metadata-filter";
import { aggregateRetrievalMetrics, evaluateRetrievalCase, matchesEvidence, type RankedChunk } from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk } from "../src/lib/rag/types";
import { cosineSimilarity } from "../src/lib/rag/vector-store";

type VariantId = "dense-cosine" | "metadata-aware-dense";
type Protocol = {
  schemaVersion: 1;
  id: string;
  title: string;
  hypothesis: string;
  baseExperimentConfig: string;
  split: "validation";
  variants: VariantId[];
  thresholds: number[];
  selectionRule: { primary: "noAnswerFalsePositiveRate"; primaryTarget: number; guardrails: { recallAtK: number; mrr: number }; tieBreakers: string[] };
  controlledVariables: string[];
  changedVariable: string;
  reportOutput: string;
};
type Metrics = ReturnType<typeof aggregateRetrievalMetrics>;
type ThresholdResult = { threshold: number; metrics: Metrics; returnedChunks: number };
type VariantResult = { variant: VariantId; selectedThreshold: number | null; selectedMetrics: Metrics | null; thresholdResults: ThresholdResult[]; decision: string };

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const protocolPath = path.resolve(options.protocol);
  const runDirectory = path.resolve(options.run);
  const protocolRaw = await fs.readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw) as Protocol;
  validateProtocol(protocol);
  const run = JSON.parse(await fs.readFile(path.join(runDirectory, "run.json"), "utf8")) as ExperimentRun;
  const configRaw = await fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8");
  const config = JSON.parse(configRaw) as ExperimentConfig;
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  if (run.status !== "prepared") throw new Error("Parent run must be prepared.");
  if (!config.evaluation.goldenSet || !config.evaluation.splitManifest || config.evaluation.split !== "validation") throw new Error("Metadata selection is restricted to validation.");
  const baseConfigRaw = await fs.readFile(path.resolve(path.dirname(protocolPath), protocol.baseExperimentConfig), "utf8");
  if (canonicalJson(baseConfigRaw) !== canonicalJson(configRaw)) throw new Error("Prepared run does not match the protocol base configuration.");
  if (!chunks.some((chunk) => chunk.version) || !chunks.some((chunk) => chunk.language === "React")) throw new Error("Prepared chunks do not contain the required propagated manifest metadata.");

  const goldenRaw = await fs.readFile(path.resolve(config.evaluation.goldenSet), "utf8");
  const splitRaw = await fs.readFile(path.resolve(config.evaluation.splitManifest), "utf8");
  const golden = await loadGoldenSet(config.evaluation.goldenSet);
  const split = await loadGoldenSetSplit(config.evaluation.splitManifest);
  const goldenValidation = await validateGoldenSet(golden);
  const splitValidation = validateGoldenSetSplit(golden, split);
  if (goldenValidation.errors.length || splitValidation.errors.length) throw new Error([...goldenValidation.errors, ...splitValidation.errors].join("\n"));
  const statuses = new Set(config.evaluation.caseStatuses ?? ["human-approved"]);
  const cases = selectGoldenSplit(golden, split, "validation")
    .filter((item) => statuses.has(item.status as "source-verified" | "human-approved"))
    .filter((item) => item.answerability === "unanswerable" || item.evidence.some((evidence) => chunks.some((chunk) => matchesEvidence(chunk, evidence))));

  const { embedTextsWithCache } = await import("../src/lib/rag/embeddings");
  const started = performance.now();
  const [documents, queries] = await Promise.all([
    embedTextsWithCache(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), { provider: config.embedding.provider as "google" | "openai" | "voyage", model: config.embedding.model, taskType: config.embedding.documentTask ?? "RETRIEVAL_DOCUMENT", outputDimensionality: config.embedding.outputDimensionality, titles: chunks.map((chunk) => chunk.title), batchSize: config.embedding.batchSize, allowProviderRequests: false }),
    embedTextsWithCache(cases.map((item) => item.question), { provider: config.embedding.provider as "google" | "openai" | "voyage", model: config.embedding.model, taskType: config.embedding.queryTask ?? "QUESTION_ANSWERING", outputDimensionality: config.embedding.outputDimensionality, batchSize: config.embedding.batchSize, allowProviderRequests: false }),
  ]);
  const rankings = cases.map((_, caseIndex) => chunks.map((chunk, chunkIndex) => ({ ...chunk, score: cosineSimilarity(queries.vectors[caseIndex], documents.vectors[chunkIndex]) })).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)));
  const compatibility = cases.map((item) => filterChunksByQueryMetadata(item.question, chunks));
  const compatibleIds = compatibility.map((item) => new Set(item.chunks.map((chunk) => chunk.id)));
  const variantRankings: Record<VariantId, Array<Array<DocumentationChunk & { score: number }>>> = {
    "dense-cosine": rankings,
    "metadata-aware-dense": rankings.map((ranking, index) => compatibility[index].decision.status === "compatible" ? ranking.filter((chunk) => compatibleIds[index].has(chunk.id)) : []),
  };
  const results = protocol.variants.map((variant) => evaluateVariant(variant, variantRankings[variant], cases, protocol));
  const decisions = cases.map((item, index) => ({ caseId: item.id, answerability: item.answerability, ...compatibility[index].decision, compatibleChunks: compatibility[index].chunks.length }));
  const createdAt = new Date().toISOString();
  const artifact = {
    schemaVersion: 1,
    id: protocol.id,
    attemptId: createdAt.replace(/[-:.TZ]/g, "").slice(0, 17),
    createdAt,
    parentRunId: run.runId,
    experimentId: run.experimentId,
    hypothesis: protocol.hypothesis,
    split: "validation",
    inputHashes: { protocol: sha256(protocolRaw), config: sha256(configRaw), chunks: sha256(chunksRaw), goldenSet: sha256(goldenRaw), splitManifest: sha256(splitRaw) },
    cache: { documentHits: documents.cache.cacheHits, queryHits: queries.cache.cacheHits, apiInputs: documents.apiInputs + queries.apiInputs, apiRequests: documents.apiRequests + queries.apiRequests },
    timingsMs: { totalScoring: Math.round(performance.now() - started) },
    metadataCoverage: { chunks: chunks.length, withLanguage: chunks.filter((chunk) => chunk.language).length, withVersion: chunks.filter((chunk) => chunk.version).length },
    controlledVariables: protocol.controlledVariables,
    changedVariable: protocol.changedVariable,
    compatibilityDecisions: decisions,
    results,
  };
  const directory = path.join(runDirectory, "metadata-filter-attempts", protocol.id, artifact.attemptId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "attempt.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(path.join(directory, "summary.md"), renderMarkdown(artifact));
  if (options.writeReport) await writeReport(protocol.reportOutput, artifact);
  console.log(`COMPLETED ${protocol.id}/${artifact.attemptId}`);
  for (const result of results) console.log(`${result.variant}: threshold=${result.selectedThreshold ?? "none"}, Recall@4=${format(result.selectedMetrics?.recallAtK)}, FPR=${format(result.selectedMetrics?.noAnswerFalsePositiveRate)}`);
}

function evaluateVariant(variant: VariantId, rankings: Array<Array<DocumentationChunk & { score: number }>>, cases: GoldenCase[], protocol: Protocol): VariantResult {
  const thresholdResults = protocol.thresholds.map((threshold) => {
    const evaluated = cases.map((testCase, index) => {
      const ranked: RankedChunk[] = rankings[index].filter((chunk) => chunk.score >= threshold).slice(0, 4).map((chunk, rank) => ({ ...chunk, rank: rank + 1 }));
      return evaluateRetrievalCase(testCase, ranked);
    });
    return { threshold, metrics: aggregateRetrievalMetrics(evaluated), returnedChunks: evaluated.reduce((total, item) => total + item.retrievedCount, 0) };
  });
  const eligible = thresholdResults.filter((item) => item.metrics.noAnswerFalsePositiveRate === protocol.selectionRule.primaryTarget && (item.metrics.recallAtK ?? -1) >= protocol.selectionRule.guardrails.recallAtK && (item.metrics.mrr ?? -1) >= protocol.selectionRule.guardrails.mrr);
  const selected = [...eligible].sort((left, right) => (right.metrics.ndcgAtK ?? -1) - (left.metrics.ndcgAtK ?? -1) || left.threshold - right.threshold || (right.metrics.precisionAtK ?? -1) - (left.metrics.precisionAtK ?? -1))[0];
  return { variant, selectedThreshold: selected?.threshold ?? null, selectedMetrics: selected?.metrics ?? null, thresholdResults, decision: selected ? "Selected by the predeclared validation rule." : "No threshold satisfied the guardrails." };
}

function renderMarkdown(artifact: { id: string; attemptId: string; parentRunId: string; hypothesis: string; cache: { apiInputs: number }; metadataCoverage: { chunks: number; withLanguage: number; withVersion: number }; changedVariable: string; compatibilityDecisions: Array<{ caseId: string; answerability: string; status: CompatibilityDecision["status"]; requestedTechnology: string | null; requestedVersion: number | null; reason: string; compatibleChunks: number }>; results: VariantResult[] }) {
  return `# Metadata-aware retrieval comparison\n\n- Protocol/attempt: \`${artifact.id}\` / \`${artifact.attemptId}\`\n- Parent run: \`${artifact.parentRunId}\`\n- Split: **validation only**\n- Hypothesis: ${artifact.hypothesis}\n- Changed variable: ${artifact.changedVariable}\n- Cache-only: **${artifact.cache.apiInputs === 0 ? "yes" : "no"}**\n- Metadata coverage: ${artifact.metadataCoverage.withLanguage}/${artifact.metadataCoverage.chunks} chunks with language, ${artifact.metadataCoverage.withVersion}/${artifact.metadataCoverage.chunks} with version\n\n| Variant | Selected threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR | Decision |\n|---|---:|---:|---:|---:|---:|---:|---|\n${artifact.results.map((item) => `| ${item.variant} | ${item.selectedThreshold ?? "n/a"} | ${format(item.selectedMetrics?.recallAtK)} | ${format(item.selectedMetrics?.precisionAtK)} | ${format(item.selectedMetrics?.mrr)} | ${format(item.selectedMetrics?.ndcgAtK)} | ${format(item.selectedMetrics?.noAnswerFalsePositiveRate)} | ${item.decision} |`).join("\n")}\n\n## Compatibility decisions\n\n| Case | Answerability | Decision | Technology | Version | Compatible chunks |\n|---|---|---|---|---:|---:|\n${artifact.compatibilityDecisions.map((item) => `| ${item.caseId} | ${item.answerability} | ${item.status} | ${item.requestedTechnology ?? "-"} | ${item.requestedVersion ?? "-"} | ${item.compatibleChunks} |`).join("\n")}\n\nThe compatibility gate is deterministic and uses manifest-derived metadata. It does not inspect expected answers or evidence. This validation result must not be reported as a new held-out test result; the previous test split has already been observed.\n`;
}

async function writeReport(output: string, artifact: Parameters<typeof renderMarkdown>[0]) {
  const base = path.resolve(output);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(`${base}.md`, renderMarkdown(artifact));
  const rows = artifact.results.map((item) => [item.variant, item.selectedThreshold ?? "", item.selectedMetrics?.recallAtK ?? "", item.selectedMetrics?.precisionAtK ?? "", item.selectedMetrics?.mrr ?? "", item.selectedMetrics?.ndcgAtK ?? "", item.selectedMetrics?.noAnswerFalsePositiveRate ?? "", item.decision]);
  await fs.writeFile(`${base}.csv`, [["variant", "selected_threshold", "recall_at_4", "precision_at_4", "mrr", "ndcg_at_4", "no_answer_fpr", "decision"], ...rows].map((row) => row.join(",")).join("\n") + "\n");
}

function validateProtocol(protocol: Protocol) { if (protocol.schemaVersion !== 1 || protocol.split !== "validation") throw new Error("Protocol must use schema v1 and validation."); if (new Set(protocol.thresholds).size !== protocol.thresholds.length) throw new Error("Thresholds must be unique."); }
function parseArgs(args: string[]) { const value = (name: string, fallback?: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }; const run = value("--run"); if (!run) throw new Error("Usage: tsx scripts/evaluate-metadata-filter.ts --run <prepared-run> [--write-report]"); return { run, protocol: value("--protocol", "docs/experiments/common-metadata-filter.v1.json")!, writeReport: args.includes("--write-report") }; }
function canonicalJson(value: string) { return JSON.stringify(JSON.parse(value)); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function format(value: number | null | undefined) { return value === null || value === undefined ? "n/a" : value.toFixed(4); }

main().catch((error) => { console.error(error); process.exit(1); });
