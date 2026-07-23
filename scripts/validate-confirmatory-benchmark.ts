import fs from "node:fs/promises";
import path from "node:path";

import type { ConfirmatoryBenchmark } from "../src/lib/evaluation/confirmatory-benchmark";

const benchmarkPath = process.argv[2] ?? "docs/evaluation/confirmatory-benchmark.v1.review.json";

async function main() {
  const benchmark = JSON.parse(await fs.readFile(path.resolve(benchmarkPath), "utf8")) as ConfirmatoryBenchmark;
  const errors: string[] = [];
  if (benchmark.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (benchmark.cases.length !== 48) errors.push(`Expected 48 cases, found ${benchmark.cases.length}.`);
  if (new Set(benchmark.cases.map((item) => item.id)).size !== 48) errors.push("Case IDs are not unique.");
  if (benchmark.counts.answerable !== 24 || benchmark.counts.unanswerable !== 24) errors.push("Declared class counts must be 24/24.");
  const answerable = benchmark.cases.filter((item) => item.answerability === "answerable");
  const unanswerable = benchmark.cases.filter((item) => item.answerability === "unanswerable");
  if (answerable.length !== 24 || unanswerable.length !== 24) errors.push(`Actual class counts are ${answerable.length}/${unanswerable.length}.`);
  const domains = new Map<string, typeof benchmark.cases>();
  for (const item of benchmark.cases) domains.set(item.domain, [...(domains.get(item.domain) ?? []), item]);
  if (domains.size !== 12) errors.push(`Expected 12 domains, found ${domains.size}.`);
  for (const [domain, items] of domains) {
    const positive = items.filter((item) => item.answerability === "answerable").length;
    const negative = items.length - positive;
    if (positive !== 2 || negative !== 2) errors.push(`${domain} has ${positive} answerable and ${negative} unanswerable cases.`);
  }
  for (const item of answerable) {
    if (!item.expected.answer || !item.expected.keyFacts.length) errors.push(`${item.id}: missing expected answer or facts.`);
    if (!item.evidencePacket.length || item.evidencePacket.some((packet) => !packet.excerpt)) errors.push(`${item.id}: missing frozen evidence packet.`);
  }
  for (const item of unanswerable) {
    if (!item.expected.refusalReason || !item.negativeVerification) errors.push(`${item.id}: missing negative rationale.`);
    if (!item.corpusCheck?.probes.length || item.corpusCheck.probes.some((probe) => probe.matches !== 0)) {
      errors.push(`${item.id}: absence probes are missing or non-zero.`);
    }
  }
  const overlapFindings = await findPriorQuestionOverlaps(benchmark);
  for (const finding of overlapFindings) {
    errors.push(`${finding.caseId}: overlaps prior question at score ${finding.score.toFixed(3)} in ${finding.file}: ${finding.priorQuestion}`);
  }
  if (benchmark.status === "awaiting-human-confirmation" && benchmark.testLocked) errors.push("A review benchmark cannot be locked.");
  if (benchmark.status === "confirmed-locked") {
    if (!benchmark.testLocked) errors.push("A confirmed benchmark must be locked.");
    if (!benchmark.confirmation) errors.push("A confirmed benchmark requires confirmation provenance.");
    for (const item of benchmark.cases) {
      if (item.status !== "human-approved" || item.approval?.state !== "confirmed") errors.push(`${item.id}: not human-approved and confirmed.`);
    }
  }
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Valid ${benchmark.status} benchmark: 48 cases, 12 domains, 24 answerable, 24 unanswerable.`);
}

async function findPriorQuestionOverlaps(benchmark: ConfirmatoryBenchmark) {
  const roots = ["docs/evaluation", "docs/experiments", "data/experiments"];
  const files = (await Promise.all(roots.map((root) => listJsonFiles(path.resolve(root))))).flat()
    .filter((file) => !path.basename(file).startsWith("confirmatory-benchmark."));
  const prior: Array<{ question: string; file: string }> = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
      collectQuestionStrings(parsed, file, "", prior);
    } catch {
      // Non-benchmark JSON or partially written experiment artifacts are ignored.
    }
  }
  const findings: Array<{ caseId: string; score: number; file: string; priorQuestion: string }> = [];
  for (const item of benchmark.cases) {
    for (const candidate of prior) {
      const score = jaccard(item.question, candidate.question);
      if (normalize(item.question) === normalize(candidate.question) || score >= 0.45) {
        findings.push({ caseId: item.id, score, file: path.relative(process.cwd(), candidate.file), priorQuestion: candidate.question });
      }
    }
  }
  return findings;
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(target);
    return entry.isFile() && entry.name.endsWith(".json") ? [target] : [];
  }));
  return nested.flat();
}

function collectQuestionStrings(value: unknown, file: string, key: string, output: Array<{ question: string; file: string }>) {
  if (Array.isArray(value)) {
    for (const item of value) collectQuestionStrings(item, file, key, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) collectQuestionStrings(child, file, childKey, output);
    return;
  }
  if (typeof value === "string" && /(question|query|prompt)/i.test(key) && value.trim().split(/\s+/).length >= 4) {
    output.push({ question: value.trim(), file });
  }
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9+#]+/g, " ").trim().replace(/\s+/g, " ");
}

function jaccard(left: string, right: string) {
  const stopWords = new Set(["what", "when", "where", "which", "does", "with", "from", "that", "this", "into", "your", "their", "about", "between", "have", "used", "using", "should", "would", "could", "according"]);
  const tokens = (value: string) => new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !stopWords.has(token)));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection || 1);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
