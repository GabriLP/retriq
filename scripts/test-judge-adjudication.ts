import assert from "node:assert/strict";
import { defaultAdjudication, exportAdjudicationCsv, isAdjudicationComplete, isPhaseOneComplete, labelFromAuditRow, type JudgeAdjudicationTask } from "../src/lib/evaluation/judge-adjudication";
import { parseCsv } from "../src/lib/evaluation/generation-review";

const judge = labelFromAuditRow({ answerability: "answerable", judge_scores: "G4/K3/CC2/CP1/D2", judge_flags: "U0/C1/I0/F0" });
assert.equal(judge.groundedness, 4);
assert.equal(judge.citationCorrectness, 2);
assert.equal(judge.contradictsEvidence, 1);

const task: JudgeAdjudicationTask = {
  id: "case::variant", caseId: "case", blindVariantId: "variant", answerability: "answerable", language: "Rust",
  question: "Question?", expectedKeyFacts: ["Fact"], frozenEvidence: "[S1]", candidateAnswer: "Answer [S1]",
  originalHuman: { ...judge, citationCorrectness: 4, contradictsEvidence: 0 }, judge, judgeRationale: "Reason", originalHumanNotes: ""
};
const review = {
  ...defaultAdjudication(), groundedness_0_4: 4, key_fact_coverage_0_4: 3, citation_correctness_0_4: 4,
  citation_completeness_0_4: 3, directness_0_2: 2, decision: "confirm-independent" as const
};
assert.equal(isPhaseOneComplete(task, review), true);
assert.equal(isAdjudicationComplete(task, review), true);
const csv = exportAdjudicationCsv({ tasks: [task], phaseOne: { frozenAt: "2026-07-21T10:00:00Z", reviews: { [task.id]: review } }, reviews: { [task.id]: review }, reviewerId: "Gabriele", exportedAt: "2026-07-21T11:00:00Z" });
const parsed = parseCsv(csv).rows[0];
assert.equal(parsed.phase1_groundedness_0_4, "4");
assert.equal(parsed.final_citation_correctness_0_4, "4");
assert.equal(parsed.adjudication_decision, "confirm-independent");
assert.equal(parsed.review_status, "adjudicated");

console.log("VALID judge adjudication parsing, completion, and CSV export.");
