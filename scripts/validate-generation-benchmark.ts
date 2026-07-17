import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { DocumentationChunk } from "../src/lib/rag/types";

type Benchmark = {
  schemaVersion: number;
  split: string;
  source: { parentRunId: string; chunksSha256: string };
  prompt: string;
  humanRubric: string;
  caseCounts: { total: number; answerable: number; unanswerable: number };
  humanCalibration: { caseIds: string[] };
  testSplit: { locked: boolean; touched: boolean; casesIncluded: number };
  cases: Array<{ caseId: string; answerability: string; evidence: Array<{ rank: number; chunkId: string; contentSha256: string; promptDocumentSha256: string }> }>;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const benchmark = JSON.parse(await fs.readFile(path.resolve(options.benchmark), "utf8")) as Benchmark;
  const chunksRaw = await fs.readFile(path.resolve(options.run, "chunks.json"), "utf8");
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  const prompt = JSON.parse(await fs.readFile(path.resolve(benchmark.prompt), "utf8")) as { schemaVersion?: number; systemInstructions?: string[]; userTemplate?: string; evidenceTemplate?: string; generationControls?: { temperature?: number; maxOutputTokens?: number }; noEvidencePolicy?: { invokeGenerator?: boolean } };
  const rubric = JSON.parse(await fs.readFile(path.resolve(benchmark.humanRubric), "utf8")) as { schemaVersion?: number; answerableDimensions?: Array<{ id?: string }>; generatorSelection?: { primaryMetric?: string }; futureJudgeCalibration?: { humanLabelsAreReference?: boolean; selfJudgingProhibited?: boolean } };
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const errors: string[] = [];
  if (benchmark.schemaVersion !== 1 || benchmark.split !== "validation") errors.push("Benchmark must use schema v1 and validation only.");
  if (prompt.schemaVersion !== 1 || !prompt.userTemplate?.includes("{{QUESTION}}") || !prompt.userTemplate.includes("{{EVIDENCE}}") || !prompt.evidenceTemplate?.includes("{{CONTENT}}")) errors.push("Generation prompt templates are incomplete.");
  if (prompt.generationControls?.temperature !== 0 || prompt.generationControls.maxOutputTokens !== 900 || prompt.noEvidencePolicy?.invokeGenerator !== false) errors.push("Generation controls or no-evidence policy are not frozen as expected.");
  const dimensionIds = new Set((rubric.answerableDimensions ?? []).map((item) => item.id));
  for (const id of ["groundedness", "keyFactCoverage", "citationCorrectness", "citationCompleteness", "directness"]) if (!dimensionIds.has(id)) errors.push(`Human rubric is missing ${id}.`);
  if (rubric.schemaVersion !== 1 || !rubric.generatorSelection?.primaryMetric || rubric.futureJudgeCalibration?.humanLabelsAreReference !== true || rubric.futureJudgeCalibration.selfJudgingProhibited !== true) errors.push("Human rubric or future judge safeguards are incomplete.");
  if (!benchmark.testSplit.locked || benchmark.testSplit.touched || benchmark.testSplit.casesIncluded !== 0) errors.push("Locked test must remain untouched and excluded.");
  if (benchmark.source.parentRunId !== path.basename(path.resolve(options.run))) errors.push("Parent run ID does not match the supplied run directory.");
  if (benchmark.source.chunksSha256 !== sha256(chunksRaw)) errors.push("Frozen chunks file hash does not match.");
  if (benchmark.cases.length !== benchmark.caseCounts.total || benchmark.caseCounts.answerable !== 27 || benchmark.caseCounts.unanswerable !== 27) errors.push("Expected a balanced 54-case validation benchmark.");
  if (new Set(benchmark.cases.map((item) => item.caseId)).size !== benchmark.cases.length) errors.push("Case IDs must be unique.");
  if (benchmark.humanCalibration.caseIds.length !== 24 || new Set(benchmark.humanCalibration.caseIds).size !== 24) errors.push("Human calibration subset must contain 24 unique cases.");
  const calibration = new Set(benchmark.humanCalibration.caseIds);
  if (benchmark.cases.filter((item) => calibration.has(item.caseId) && item.answerability === "answerable").length !== 12) errors.push("Human calibration must contain twelve answerable cases.");
  for (const item of benchmark.cases) {
    if (item.answerability === "unanswerable" && item.evidence.length) errors.push(`${item.caseId}: unanswerable case contains evidence.`);
    if (new Set(item.evidence.map((evidence) => evidence.rank)).size !== item.evidence.length) errors.push(`${item.caseId}: evidence ranks are duplicated.`);
    for (const evidence of item.evidence) {
      const chunk = byId.get(evidence.chunkId);
      if (!chunk) { errors.push(`${item.caseId}: missing chunk ${evidence.chunkId}.`); continue; }
      if (sha256(chunk.content) !== evidence.contentSha256) errors.push(`${item.caseId}: content hash mismatch for ${chunk.id}.`);
      if (sha256(`${chunk.title}\n${chunk.section}\n${chunk.sourceUrl}\n${chunk.content}`) !== evidence.promptDocumentSha256) errors.push(`${item.caseId}: prompt hash mismatch for ${chunk.id}.`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`VALID generation benchmark: ${benchmark.cases.length} validation cases, ${benchmark.humanCalibration.caseIds.length} calibration cases, locked test untouched.`);
}

function parseArgs(args: string[]) { const value = (name: string, fallback: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }; return { benchmark: value("--benchmark", "docs/evaluation/generation-benchmark.v1.json"), run: value("--run", "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec") }; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

main().catch((error) => { console.error(error); process.exit(1); });
