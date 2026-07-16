import fs from "node:fs/promises";
import path from "node:path";

import type { GoldenCase, GoldenSet, GoldenSetSplit } from "../src/lib/rag/golden-set";

const reviewedAt = "2026-07-16T00:00:00.000Z";

async function main() {
  const inputPath = path.resolve(readArg("--input", "docs/evaluation/golden-set.v1.json"));
  const outputPath = path.resolve(readArg("--output", "docs/evaluation/golden-set.v2.json"));
  const splitPath = path.resolve(readArg("--split", "docs/evaluation/golden-set-splits.v2.json"));
  const checklistPath = path.resolve(readArg("--checklist", "docs/evaluation/HUMAN_REVIEW_CHECKLIST_V2.md"));
  const original = JSON.parse(await fs.readFile(inputPath, "utf8")) as GoldenSet;
  const originalScoredIds = original.cases.filter((item) => item.status === "source-verified").map((item) => item.id);
  const promotedDraftIds = ["c-array-decay-001", "java-overload-resolution-001", "postgresql-transaction-001"];
  const cases = original.cases.map((item) => provisionalApproval(completeDraft(structuredClone(item))));
  const newNegatives = negativeCases().map(provisionalApproval);
  const dataset: GoldenSet = {
    ...original,
    version: "2.0.0-provisional-human-review",
    title: "Retriq programming documentation golden set - provisional human review",
    description: "Balanced retrieval benchmark. Every case is operationally marked human-approved at the user's request, with independent confirmation explicitly pending in approval provenance.",
    createdAt: reviewedAt,
    cases: [...cases, ...newNegatives],
  };
  const split: GoldenSetSplit = {
    schemaVersion: 1,
    id: "retriq-programming-qa-validation-test-v2",
    version: "2.0.0",
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    createdAt: reviewedAt,
    method: "Prior scored cases remain in validation. Three newly source-verified answerable drafts and three new absence-verified hard negatives form a fresh balanced test split.",
    seed: "retriq-thesis-split-v2-fresh-cases",
    eligibleStatuses: ["human-approved"],
    stratifyBy: ["answerability", "difficulty", "language/domain", "negative category"],
    testLocked: true,
    validationCaseIds: originalScoredIds,
    testCaseIds: [...promotedDraftIds, ...newNegatives.map((item) => item.id)],
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
  await fs.writeFile(splitPath, `${JSON.stringify(split, null, 2)}\n`);
  await fs.writeFile(checklistPath, renderChecklist(dataset, split));
  console.log(`BUILT ${dataset.id}@${dataset.version}: ${dataset.cases.length} cases.`);
  console.log(`Fresh test: ${split.testCaseIds.length} cases; validation: ${split.validationCaseIds.length} cases.`);
}

function completeDraft(item: GoldenCase): GoldenCase {
  if (item.id === "c-array-decay-001") {
    return {
      ...item,
      expected: {
        answer: "An array expression is not converted to a pointer when it is the operand of sizeof, _Alignof, or unary &, or when it is a string literal used to initialize an array.",
        keyFacts: ["The exceptions are sizeof, _Alignof, and unary &.", "A string literal used to initialize an array is also exempt.", "Otherwise the result points to the initial array element and is not an lvalue."],
      },
      evidence: [{ sourceId: "c11-working-draft-n1570", pageStart: 72, pageEnd: 73, section: "6.3.2.1 Lvalues, arrays, and function designators" }],
      notes: "Source-verified from C11 N1570 paragraph 6.3.2.1(3); independent user confirmation pending.",
      verifiedBy: "local-pdf-extraction-inspection",
      verifiedAt: reviewedAt,
    };
  }
  if (item.id === "java-overload-resolution-001") {
    return {
      ...item,
      expected: {
        answer: "Java first searches matching-arity methods applicable by strict invocation, then matching-arity methods by loose invocation only if phase 1 finds none, and finally variable-arity methods only if phase 2 finds none. Once a phase succeeds, the most specific applicable method is selected and later phases are not considered.",
        keyFacts: ["Phase 1 tests strict invocation.", "Phase 2 tests loose invocation only if phase 1 finds no applicable method.", "Phase 3 tests variable arity only if phase 2 finds none.", "A successful phase selects the most specific method without proceeding to later phases."],
      },
      evidence: [{ sourceId: "java-se-26-language-specification", pageStart: 656, pageEnd: 658, section: "15.12.2.2-15.12.2.4 Applicability phases" }],
      notes: "Source-verified from JLS 15.12.2.2 through 15.12.2.4; independent user confirmation pending.",
      verifiedBy: "local-pdf-extraction-inspection",
      verifiedAt: reviewedAt,
    };
  }
  if (item.id === "postgresql-transaction-001") {
    return {
      ...item,
      expected: {
        answer: "The statements between BEGIN and COMMIT form one atomic transaction: either all their effects occur or none do. Intermediate updates are invisible to other transactions; COMMIT makes the completed updates visible, while failure or ROLLBACK cancels them.",
        keyFacts: ["The transaction is all-or-nothing.", "Intermediate states are invisible to concurrent transactions.", "COMMIT completes the transaction; ROLLBACK cancels updates made so far."],
      },
      evidence: [{ sourceId: "postgresql-18-manual", pageStart: 57, pageEnd: 58, section: "3.4 Transactions" }],
      notes: "Source-verified from PostgreSQL 18 manual section 3.4; independent user confirmation pending.",
      verifiedBy: "local-pdf-extraction-inspection",
      verifiedAt: reviewedAt,
    };
  }
  return item;
}

function provisionalApproval(item: GoldenCase): GoldenCase {
  return {
    ...item,
    status: "human-approved",
    approval: {
      state: "pending-confirmation",
      approvedBy: "user-delegated-ai-review",
      approvedAt: reviewedAt,
      basis: "Operational approval requested by the user after source/corpus verification; the user will independently confirm the case before final thesis reporting.",
    },
  };
}

function negativeCases(): GoldenCase[] {
  return [
    negative("c-cuda-unified-memory-001", "C", "How do cudaMemPrefetchAsync and cudaMemAdvise control placement of CUDA Unified Memory allocated with cudaMallocManaged?", "adjacent-technology", "The corpus contains C and system-library documentation, not the NVIDIA CUDA Runtime API documentation.", ["cudaMemPrefetchAsync", "cudaMallocManaged", "cudaMemAdvise"]),
    negative("java-hibernate-lazyinit-001", "Java", "When does Hibernate throw LazyInitializationException while traversing a lazily loaded association?", "adjacent-technology", "The corpus contains the Java language specification and Java data-structure material, not Hibernate ORM documentation.", ["LazyInitializationException", "Hibernate.initialize", "FetchType.LAZY"]),
    negative("postgresql-pg-partman-retention-001", "PostgreSQL", "How does pg_partman create_parent configure retention and automatically detach old PostgreSQL partitions?", "adjacent-technology", "The corpus contains the upstream PostgreSQL manual, not the pg_partman extension documentation.", ["pg_partman", "create_parent", "retention_keep_table"]),
  ];
}

function negative(id: string, language: string, question: string, category: "adjacent-technology", scopeBasis: string, absenceProbes: string[]): GoldenCase {
  return {
    id, status: "source-verified", language, domain: "adjacent-technology", question,
    answerability: "unanswerable", difficulty: "hard", questionType: "unanswerable",
    expected: { keyFacts: [], refusalReason: scopeBasis }, evidence: [],
    tags: ["negative", "hard-negative", "adjacent-technology", language.toLowerCase()],
    negativeVerification: { category, scopeBasis, absenceProbes },
    authoredBy: "codex-assisted-curation", verifiedBy: "corpus-scope-and-absence-probe", verifiedAt: reviewedAt,
  };
}

function renderChecklist(dataset: GoldenSet, split: GoldenSetSplit) {
  const testIds = new Set(split.testCaseIds);
  return `# Human review checklist - benchmark v2\n\nEvery case is operationally marked \`human-approved\` with \`approval.state=pending-confirmation\`. Check the source/evidence and change the state to \`confirmed\` only after independent review. The fresh test split must not be executed until its six cases are confirmed and the selection rule is frozen.\n\n| Confirm | Case | Split | Answerability | Language | Evidence or negative basis |\n|---|---|---|---|---|---|\n${dataset.cases.map((item) => `| [ ] | \`${item.id}\` | ${testIds.has(item.id) ? "test" : "validation"} | ${item.answerability} | ${item.language} | ${item.answerability === "answerable" ? item.evidence.map((evidence) => `${evidence.sourceId ?? evidence.sourceUrl} p.${evidence.pageStart ?? "web"}-${evidence.pageEnd ?? "web"}`).join("; ") : item.negativeVerification?.scopeBasis} |`).join("\n")}\n`;
}

function readArg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
