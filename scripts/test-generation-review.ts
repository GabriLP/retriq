import assert from "node:assert/strict";

import { buildReviewTasks, exportReviewedCsv, isReviewComplete, parseCsv } from "../src/lib/evaluation/generation-review";

const fixture = `case_id,blind_variant_id,answerability,language,question,expected_key_facts,frozen_evidence,candidate_answer,groundedness_0_4,key_fact_coverage_0_4,citation_correctness_0_4,citation_completeness_0_4,directness_0_2,correct_abstention_0_1,critical_unsupported_claim_0_1,contradicts_evidence_0_1,invalid_citation_label_0_1,generator_failure_0_1,reviewer_notes
a,v1,answerable,Rust,"Question, with comma",fact one | fact two,"evidence\nline",answer,,,,,,,,,,,
u,v1,unanswerable,Python,Unknown,,,Decline,,,,,,,,,,,
u,v2,unanswerable,Python,Unknown,,,Decline,,,,,,,,,,,
u,v3,unanswerable,Python,Unknown,,,Decline,,,,,,,,,,,
`;

const parsed = parseCsv(fixture);
assert.equal(parsed.rows.length, 4);
assert.equal(parsed.rows[0].question, "Question, with comma");
const tasks = buildReviewTasks(parsed.rows);
assert.equal(tasks.length, 2);
assert.equal(tasks.find((task) => task.answerability === "unanswerable")?.sourceRowIds.length, 3);
const answerable = tasks.find((task) => task.answerability === "answerable")!;
const unanswerable = tasks.find((task) => task.answerability === "unanswerable")!;
const reviews = {
  [answerable.id]: { groundedness_0_4: 4, key_fact_coverage_0_4: 4, citation_correctness_0_4: 4, citation_completeness_0_4: 4, directness_0_2: 2, critical_unsupported_claim_0_1: 0, contradicts_evidence_0_1: 0, invalid_citation_label_0_1: 0, generator_failure_0_1: 0 },
  [unanswerable.id]: { correct_abstention_0_1: 1, critical_unsupported_claim_0_1: 0, contradicts_evidence_0_1: 0, invalid_citation_label_0_1: 0, generator_failure_0_1: 0 },
};
assert.equal(isReviewComplete(answerable, reviews[answerable.id]), true);
const exported = parseCsv(exportReviewedCsv({ headers: parsed.headers, rows: parsed.rows, tasks, reviews, reviewerId: "Gabriele", reviewedAt: "2026-07-17T12:00:00Z" }));
assert.equal(exported.rows.length, 4);
assert.equal(exported.rows.filter((row) => row.review_status === "human-reviewed").length, 4);
assert.equal(exported.rows.filter((row) => row.case_id === "u").every((row) => row.correct_abstention_0_1 === "1"), true);
console.log("Generation review CSV parsing, deduplication, completion, and export passed.");
