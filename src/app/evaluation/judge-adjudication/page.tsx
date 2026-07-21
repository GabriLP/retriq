import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { JudgeAdjudicationWorkbench } from "@/components/judge-adjudication-workbench";
import { labelFromAuditRow, labelFromHumanRow, type JudgeAdjudicationTask } from "@/lib/evaluation/judge-adjudication";
import { parseCsv } from "@/lib/evaluation/generation-review";

export const metadata = {
  title: "Judge adjudication · Retriq",
  description: "Accessible blinded adjudication of LLM judge disagreements."
};

type Manifest = {
  sources: { humanReviewSha256: string; judgeAuditSha256: string };
  selection: { rowIds: string[] };
};

export default async function JudgeAdjudicationPage() {
  const humanPath = path.join(process.cwd(), "docs/evaluation/generation-human-review-v1.completed.csv");
  const auditPath = path.join(process.cwd(), "docs/experiment-results/llm-judge-calibration-v1.1-disagreement-audit.csv");
  const manifestPath = path.join(process.cwd(), "docs/evaluation/llm-judge-human-adjudication.v1.json");
  const [humanText, auditText, manifestText] = await Promise.all([
    fs.readFile(humanPath, "utf8"), fs.readFile(auditPath, "utf8"), fs.readFile(manifestPath, "utf8")
  ]);
  const manifest = JSON.parse(manifestText) as Manifest;
  if (sha256(humanText) !== manifest.sources.humanReviewSha256 || sha256(auditText) !== manifest.sources.judgeAuditSha256) {
    throw new Error("Judge adjudication sources no longer match the frozen manifest.");
  }
  const humanById = new Map(parseCsv(humanText).rows.map((row) => [`${row.case_id}::${row.blind_variant_id}`, row]));
  const auditById = new Map(parseCsv(auditText).rows.map((row) => [row.row_id, row]));
  const tasks: JudgeAdjudicationTask[] = manifest.selection.rowIds.map((id) => {
    const human = humanById.get(id);
    const audit = auditById.get(id);
    if (!human || !audit) throw new Error(`Missing adjudication source row ${id}.`);
    return {
      id,
      caseId: human.case_id,
      blindVariantId: human.blind_variant_id,
      answerability: human.answerability as JudgeAdjudicationTask["answerability"],
      language: human.language,
      question: human.question,
      expectedKeyFacts: human.expected_key_facts.split(" | ").map((fact) => fact.trim()).filter(Boolean),
      frozenEvidence: human.frozen_evidence,
      candidateAnswer: human.candidate_answer,
      originalHuman: labelFromHumanRow(human),
      judge: labelFromAuditRow(audit),
      judgeRationale: audit.judge_rationale,
      originalHumanNotes: human.reviewer_notes
    };
  });
  return <JudgeAdjudicationWorkbench tasks={tasks} />;
}

function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
