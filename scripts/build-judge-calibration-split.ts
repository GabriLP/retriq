import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../src/lib/evaluation/generation-review";

const salt = "retriq-llm-judge-calibration-v1";

async function main() {
  const input = path.resolve("docs/evaluation/generation-human-review-v1.completed.csv");
  const output = path.resolve("docs/evaluation/llm-judge-split.v1.json");
  const text = await fs.readFile(input, "utf8");
  const { rows } = parseCsv(text);
  if (rows.length !== 72) throw new Error(`Expected 72 human-reference rows, received ${rows.length}.`);

  const assignment = new Map<string, "calibration" | "audit">();
  const variants = [...new Set(rows.map((row) => row.blind_variant_id))].sort();
  for (const variant of variants) {
    const answerable = rows.filter((row) => row.answerability === "answerable" && row.blind_variant_id === variant);
    if (answerable.length !== 12) throw new Error(`${variant} must have 12 answerable rows.`);
    hashed(answerable, (row) => rowId(row)).forEach((row, index) => assignment.set(rowId(row), index < 8 ? "calibration" : "audit"));
  }

  const unanswerableCaseIds = [...new Set(rows.filter((row) => row.answerability === "unanswerable").map((row) => row.case_id))];
  if (unanswerableCaseIds.length !== 12) throw new Error(`Expected 12 unique unanswerable cases, received ${unanswerableCaseIds.length}.`);
  const unanswerableSplit = new Map(hashed(unanswerableCaseIds, (value) => value).map((caseId, index) => [caseId, index < 8 ? "calibration" : "audit"] as const));
  for (const row of rows.filter((item) => item.answerability === "unanswerable")) assignment.set(rowId(row), unanswerableSplit.get(row.case_id)!);

  const assignments = rows.map((row) => ({
    rowId: rowId(row),
    caseId: row.case_id,
    blindVariantId: row.blind_variant_id,
    answerability: row.answerability,
    split: assignment.get(rowId(row)),
  })).sort((left, right) => left.rowId.localeCompare(right.rowId));
  const counts = Object.fromEntries(["calibration", "audit"].map((split) => [split, {
    rows: assignments.filter((item) => item.split === split).length,
    answerableRows: assignments.filter((item) => item.split === split && item.answerability === "answerable").length,
    unanswerableRows: assignments.filter((item) => item.split === split && item.answerability === "unanswerable").length,
    uniqueUnanswerableCases: new Set(assignments.filter((item) => item.split === split && item.answerability === "unanswerable").map((item) => item.caseId)).size,
  }]));
  const artifact = {
    schemaVersion: 1,
    id: "retriq-llm-judge-split-v1",
    source: "docs/evaluation/generation-human-review-v1.completed.csv",
    sourceSha256: sha256(text),
    algorithm: "SHA-256 order with fixed salt; answerable rows stratified 8/4 by blind variant; unanswerable cases grouped before an 8/4 split so repeated deterministic answers cannot cross splits.",
    salt,
    counts,
    assignments,
  };
  await fs.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), output)}: ${counts.calibration.rows} calibration, ${counts.audit.rows} audit.`);
}

function hashed<T>(values: T[], key: (value: T) => string) {
  return [...values].sort((left, right) => sha256(`${salt}:${key(left)}`).localeCompare(sha256(`${salt}:${key(right)}`)));
}
function rowId(row: Record<string, string>) { return `${row.case_id}::${row.blind_variant_id}`; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

main().catch((error) => { console.error(error); process.exit(1); });
