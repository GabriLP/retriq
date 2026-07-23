import fs from "node:fs/promises";
import path from "node:path";

import type { ConfirmatoryBenchmark } from "../src/lib/evaluation/confirmatory-benchmark";

const reviewCsv = process.argv[2];
const seedFile = process.argv[3] ?? "docs/evaluation/confirmatory-benchmark.v1.review.json";
const outputFile = process.argv[4] ?? "docs/evaluation/confirmatory-benchmark.v1.json";

async function main() {
  if (!reviewCsv) throw new Error("Usage: tsx scripts/finalize-confirmatory-benchmark.ts <completed-review.csv> [seed.json] [output.json]");
  const benchmark = JSON.parse(await fs.readFile(path.resolve(seedFile), "utf8")) as ConfirmatoryBenchmark;
  if (benchmark.status !== "awaiting-human-confirmation" || benchmark.testLocked) {
    throw new Error("The source benchmark must be awaiting confirmation and unlocked.");
  }
  const rows = parseCsv(await fs.readFile(path.resolve(reviewCsv), "utf8"));
  const byId = new Map(rows.map((row) => [row.case_id, row]));
  if (rows.length !== benchmark.cases.length || byId.size !== benchmark.cases.length) {
    throw new Error(`Expected exactly ${benchmark.cases.length} unique review rows, received ${rows.length}/${byId.size}.`);
  }
  const reviewers = new Set(rows.map((row) => row.reviewer?.trim()).filter(Boolean));
  if (reviewers.size !== 1) throw new Error("The completed review must name exactly one non-empty reviewer.");
  const reviewer = [...reviewers][0]!;
  for (const item of benchmark.cases) {
    const row = byId.get(item.id);
    if (!row) throw new Error(`Missing review row for ${item.id}.`);
    if (row.benchmark_id !== benchmark.id || row.benchmark_version !== benchmark.version) throw new Error(`${item.id}: benchmark identity mismatch.`);
    if (row.decision !== "approved") throw new Error(`${item.id}: decision is '${row.decision || "empty"}'; correct and re-review it before locking.`);
    if (!row.reviewed_at) throw new Error(`${item.id}: reviewed_at is missing.`);
  }
  const confirmedAt = new Date().toISOString();
  const confirmed: ConfirmatoryBenchmark = {
    ...benchmark,
    version: "1.0.0",
    status: "confirmed-locked",
    testLocked: true,
    cases: benchmark.cases.map((item) => ({
      ...item,
      status: "human-approved",
      approval: {
        state: "confirmed",
        approvedBy: reviewer,
        approvedAt: byId.get(item.id)!.reviewed_at,
        basis: "Explicit case-by-case author review of question, expected label, and frozen corpus evidence or absence rationale.",
      },
      notes: byId.get(item.id)!.notes || undefined,
    })),
    confirmation: {
      reviewer,
      confirmedAt,
      sourceReviewFile: path.basename(reviewCsv),
      decision: "all-approved",
    },
  };
  await fs.writeFile(path.resolve(outputFile), `${JSON.stringify(confirmed, null, 2)}\n`);
  console.log(`Locked ${outputFile}: ${confirmed.cases.length} cases confirmed by ${reviewer}.`);
}

function parseCsv(text: string) {
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.length)) matrix.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    matrix.push(row);
  }
  const [headers, ...values] = matrix;
  if (!headers) return [];
  return values.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))) as Array<Record<string, string>>;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
