import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../src/lib/evaluation/generation-review";

const salt = "retriq-judge-adjudication-v1";

async function main() {
  const auditPath = path.resolve("docs/experiment-results/llm-judge-calibration-v1.1-disagreement-audit.csv");
  const humanPath = path.resolve("docs/evaluation/generation-human-review-v1.completed.csv");
  const outputPath = path.resolve("docs/evaluation/llm-judge-human-adjudication.v1.json");
  const auditText = await fs.readFile(auditPath, "utf8");
  const humanText = await fs.readFile(humanPath, "utf8");
  const auditRows = parseCsv(auditText).rows;
  const humanRows = parseCsv(humanText).rows;
  const humanIds = new Set(humanRows.map(rowId));

  const answerable = auditRows.filter((row) => row.answerability === "answerable");
  if (answerable.length !== 12) throw new Error(`Expected 12 answerable audit rows, received ${answerable.length}.`);
  const uniqueUnanswerable = new Map<string, typeof auditRows[number]>();
  for (const row of [...auditRows].filter((item) => item.answerability === "unanswerable").sort((left, right) => rowId(left).localeCompare(rowId(right)))) {
    if (!uniqueUnanswerable.has(row.case_id)) uniqueUnanswerable.set(row.case_id, row);
  }
  const unanswerable = [...uniqueUnanswerable.values()]
    .sort((left, right) => hash(`${salt}:${left.case_id}`).localeCompare(hash(`${salt}:${right.case_id}`)))
    .slice(0, 3);
  const selected = [...answerable, ...unanswerable];
  for (const row of selected) if (!humanIds.has(rowId(row))) throw new Error(`Missing human source row ${rowId(row)}.`);
  const orderedRowIds = selected
    .map(rowId)
    .sort((left, right) => hash(`${salt}:order:${left}`).localeCompare(hash(`${salt}:order:${right}`)));
  const artifact = {
    schemaVersion: 1,
    id: "llm-judge-human-adjudication-v1",
    createdAt: new Date().toISOString(),
    purpose: "Accessible blinded re-review of the complete answerable judge audit plus a small unique abstention control.",
    sources: {
      humanReview: "docs/evaluation/generation-human-review-v1.completed.csv",
      humanReviewSha256: hash(humanText),
      judgeAudit: "docs/experiment-results/llm-judge-calibration-v1.1-disagreement-audit.csv",
      judgeAuditSha256: hash(auditText)
    },
    selection: {
      salt,
      answerable: "All 12 held-out audit rows.",
      unanswerable: "Three unique case IDs selected by SHA-256 order; one deterministic-answer row per case.",
      counts: { total: 15, answerable: 12, unanswerable: 3 },
      rowIds: orderedRowIds
    },
    reviewProtocol: {
      phase1: "Score every case from candidate answer, expected facts, and frozen evidence. Human and judge references remain hidden.",
      phase2: "After all phase-1 scores are frozen, reveal both references and record an adjudication decision. Final scores may be edited but phase-1 values remain preserved.",
      originalArtifactsRemainImmutable: true
    }
  };
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)} with ${orderedRowIds.length} unique review tasks.`);
}

function rowId(row: Record<string, string>) { return `${row.case_id}::${row.blind_variant_id}`; }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

main().catch((error) => { console.error(error); process.exit(1); });
