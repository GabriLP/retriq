import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { GoldenCase } from "../src/lib/rag/golden-set";
import type { RetrievalCaseResult } from "../src/lib/rag/retrieval-metrics";
import type { DocumentationChunk } from "../src/lib/rag/types";

type RetrievalAttempt = {
  attemptId: string;
  createdAt: string;
  parentRunId: string;
  experimentId: string;
  split: "validation";
  inputHashes: Record<string, string>;
  code: { gitCommit: string; dirty: boolean; gitDiffHash: string };
  controls: { candidateDepth: number; finalTopK: number; denseEligibilityThreshold: number };
  selectedVariant: string;
  testSplitTouched: boolean;
  results: Array<{ variant: string; cases: RetrievalCaseResult[] }>;
};

type GoldenSet = { id: string; version: string; cases: GoldenCase[] };
type Split = { id: string; version: string; validationCaseIds: string[]; testCaseIds: string[]; testLocked: boolean };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDirectory = path.resolve(options.run);
  const attemptPath = path.resolve(options.attempt);
  const attemptRaw = await fs.readFile(attemptPath, "utf8");
  const attempt = JSON.parse(attemptRaw) as RetrievalAttempt;
  const chunksRaw = await fs.readFile(path.join(runDirectory, "chunks.json"), "utf8");
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  const goldenRaw = await fs.readFile(path.resolve(options.golden), "utf8");
  const golden = JSON.parse(goldenRaw) as GoldenSet;
  const splitRaw = await fs.readFile(path.resolve(options.split), "utf8");
  const split = JSON.parse(splitRaw) as Split;
  if (attempt.split !== "validation" || attempt.testSplitTouched || !split.testLocked) throw new Error("Generation evidence may only be frozen from validation while test remains locked.");
  if (attempt.selectedVariant !== "no-reranker") throw new Error("Expected the selected retrieval variant to be no-reranker.");
  const result = attempt.results.find((item) => item.variant === attempt.selectedVariant);
  if (!result) throw new Error(`Missing selected retrieval result ${attempt.selectedVariant}.`);
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const goldenById = new Map(golden.cases.map((item) => [item.id, item]));
  const testIds = new Set(split.testCaseIds);
  const cases = result.cases.map((retrievalCase) => {
    if (testIds.has(retrievalCase.caseId)) throw new Error(`Locked test case ${retrievalCase.caseId} appeared in retrieval evidence.`);
    const goldenCase = goldenById.get(retrievalCase.caseId);
    if (!goldenCase) throw new Error(`Unknown golden case ${retrievalCase.caseId}.`);
    const evidence = retrievalCase.rankedChunks.map((retrieved) => {
      const chunk = chunkById.get(retrieved.chunkId);
      if (!chunk) throw new Error(`Missing chunk ${retrieved.chunkId}.`);
      return {
        rank: retrieved.rank,
        chunkId: chunk.id,
        cosineScore: retrieved.score,
        title: chunk.title,
        section: chunk.section,
        sourceId: chunk.sourceId ?? null,
        sourceUrl: chunk.sourceUrl,
        pageStart: chunk.pageStart ?? null,
        pageEnd: chunk.pageEnd ?? null,
        wordCount: chunk.wordCount,
        contentSha256: sha256(chunk.content),
        promptDocumentSha256: sha256(`${chunk.title}\n${chunk.section}\n${chunk.sourceUrl}\n${chunk.content}`),
      };
    });
    return {
      caseId: goldenCase.id,
      language: goldenCase.language,
      domain: goldenCase.domain,
      difficulty: goldenCase.difficulty,
      questionType: goldenCase.questionType,
      answerability: goldenCase.answerability,
      question: goldenCase.question,
      expected: goldenCase.expected,
      evidence,
      retrievalRelevantCount: retrievalCase.relevantRetrieved,
      generationPolicy: evidence.length ? "invoke-generator" : "deterministic-abstention",
    };
  });
  const calibrationSeed = "retriq-generation-human-calibration-v1";
  const calibrationCaseIds = [
    ...selectCalibration(cases.filter((item) => item.answerability === "answerable"), 12, calibrationSeed),
    ...selectCalibration(cases.filter((item) => item.answerability === "unanswerable"), 12, calibrationSeed),
  ];
  const artifact = {
    schemaVersion: 1,
    id: "retriq-generation-benchmark-v1",
    version: "1.0.0",
    createdAt: attempt.createdAt,
    split: "validation",
    source: {
      goldenSet: options.golden,
      goldenSetId: golden.id,
      goldenSetVersion: golden.version,
      splitManifest: options.split,
      splitId: split.id,
      splitVersion: split.version,
      retrievalAttempt: relativePath(attemptPath),
      retrievalAttemptId: attempt.attemptId,
      parentRunId: attempt.parentRunId,
      experimentId: attempt.experimentId,
      retrievalCode: attempt.code,
      inputHashes: attempt.inputHashes,
      chunksSha256: sha256(chunksRaw),
      goldenSetSha256: sha256(goldenRaw),
      splitManifestSha256: sha256(splitRaw),
    },
    frozenRetrieval: {
      embeddingModel: "gemini-embedding-2",
      embeddingDimensions: 1024,
      metadataAware: true,
      denseEligibilityThreshold: attempt.controls.denseEligibilityThreshold,
      reranker: null,
      topK: attempt.controls.finalTopK,
    },
    prompt: "docs/evaluation/generation-prompt.v1.json",
    humanRubric: "docs/evaluation/generation-human-rubric.v1.json",
    caseCounts: {
      total: cases.length,
      answerable: cases.filter((item) => item.answerability === "answerable").length,
      unanswerable: cases.filter((item) => item.answerability === "unanswerable").length,
      invokeGenerator: cases.filter((item) => item.generationPolicy === "invoke-generator").length,
      deterministicAbstention: cases.filter((item) => item.generationPolicy === "deterministic-abstention").length,
    },
    humanCalibration: {
      method: "Take the twelve lowest SHA-256 orderings per answerability stratum using a predeclared seed.",
      seed: calibrationSeed,
      selectedBeforeGeneration: true,
      caseIds: calibrationCaseIds,
    },
    testSplit: { locked: true, touched: false, casesIncluded: 0 },
    cases,
  };
  const output = path.resolve(options.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(output.replace(/\.json$/, ".md"), renderMarkdown(artifact));
  await fs.writeFile(output.replace(/\.json$/, ".csv"), renderCsv(artifact));
  console.log(`Frozen ${cases.length} validation cases with ${cases.reduce((sum, item) => sum + item.evidence.length, 0)} evidence references; test cases included: 0.`);
}

function selectCalibration<T extends { caseId: string }>(cases: T[], count: number, seed: string) {
  return [...cases].sort((left, right) => sha256(`${seed}:${left.caseId}`).localeCompare(sha256(`${seed}:${right.caseId}`))).slice(0, count).map((item) => item.caseId);
}

function renderMarkdown(artifact: { id: string; createdAt: string; caseCounts: Record<string, number>; humanCalibration: { caseIds: string[] }; testSplit: { touched: boolean }; cases: Array<{ language: string; answerability: string; evidence: unknown[] }> }) {
  const languages = [...new Set(artifact.cases.map((item) => item.language))].sort();
  return `# Frozen generation benchmark v1\n\n- Benchmark: \`${artifact.id}\`\n- Frozen from retrieval attempt: ${artifact.createdAt}\n- Cases: ${artifact.caseCounts.total} (${artifact.caseCounts.answerable} answerable + ${artifact.caseCounts.unanswerable} unanswerable)\n- Generator invocations: ${artifact.caseCounts.invokeGenerator}; deterministic abstentions: ${artifact.caseCounts.deterministicAbstention}\n- Frozen evidence references: ${artifact.cases.reduce((sum, item) => sum + item.evidence.length, 0)}\n- Languages represented: ${languages.join(", ")}\n- Human calibration subset: ${artifact.humanCalibration.caseIds.length} cases\n- Locked test touched: **${artifact.testSplit.touched ? "yes" : "no"}**\n\nThe tracked benchmark stores chunk identifiers, retrieval order, source metadata, and content hashes rather than duplicating source text. Generation scripts must reconstruct each excerpt from the frozen parent run and reject any hash mismatch. The calibration subset was selected before generator outputs existed.\n`;
}

function renderCsv(artifact: { humanCalibration: { caseIds: string[] }; cases: Array<{ caseId: string; language: string; domain: string; difficulty: string; questionType: string; answerability: string; evidence: unknown[]; generationPolicy: string }> }) {
  const selected = new Set(artifact.humanCalibration.caseIds);
  const rows = artifact.cases.map((item) => [item.caseId, item.language, item.domain, item.difficulty, item.questionType, item.answerability, item.evidence.length, item.generationPolicy, selected.has(item.caseId)]);
  return [["case_id", "language", "domain", "difficulty", "question_type", "answerability", "evidence_chunks", "generation_policy", "human_calibration"], ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function parseArgs(args: string[]) { const value = (name: string, fallback: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }; return { run: value("--run", "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec"), attempt: value("--attempt", "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec/reranking-attempts/reranking-v1/20260717093322581/attempt.json"), golden: value("--golden", "docs/evaluation/golden-set.v4.json"), split: value("--split", "docs/evaluation/golden-set-splits.v4.json"), output: value("--output", "docs/evaluation/generation-benchmark.v1.json") }; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function relativePath(value: string) { return path.relative(process.cwd(), value).replaceAll("\\", "/"); }
function csvCell(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

main().catch((error) => { console.error(error); process.exit(1); });
