import fs from "node:fs/promises";
import path from "node:path";

import type { GoldenCase, GoldenNegativeCategory, GoldenQuestionType, GoldenSet, GoldenSetSplit } from "../src/lib/rag/golden-set";

const reviewedAt = "2026-07-16T00:00:00.000Z";

async function main() {
  const original = JSON.parse(await fs.readFile(path.resolve("docs/evaluation/golden-set.v3.json"), "utf8")) as GoldenSet;
  const previousSplit = JSON.parse(await fs.readFile(path.resolve("docs/evaluation/golden-set-splits.v3.json"), "utf8")) as GoldenSetSplit;
  const positives = answerableCases().map(provisionalApproval);
  const negatives = negativeCases().map(provisionalApproval);
  const testIds = new Set([
    "python-default-argument-once-001",
    "typescript-discriminated-union-001",
    "rust-question-mark-result-001",
    "python-sqlalchemy-async-001",
    "typescript-deno-permissions-001",
    "rust-axum-state-001",
  ]);
  const inheritedCases = original.cases.map(repairInheritedNegativeProbe);
  const additions = [...positives, ...negatives];
  const dataset: GoldenSet = {
    ...original,
    version: "4.0.0-html-language-coverage",
    title: "Retriq programming documentation golden set - HTML language coverage",
    description: "Balanced 78-case retrieval benchmark adding source-grounded Python, TypeScript, and Rust coverage after reproducible multipage HTML acquisition.",
    createdAt: reviewedAt,
    cases: [...inheritedCases, ...additions],
  };
  const split: GoldenSetSplit = {
    schemaVersion: 1,
    id: "retriq-programming-qa-validation-test-v4",
    version: "4.0.0",
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    createdAt: reviewedAt,
    method: "Preserve every v3 split assignment. Add six source-grounded answerable and six hard-negative cases to validation, plus a locked increment containing one answerable and one hard-negative case for each newly covered language.",
    seed: "retriq-thesis-split-v4-html-languages",
    eligibleStatuses: ["human-approved"],
    stratifyBy: ["answerability", "language", "difficulty", "negative category", "source family"],
    testLocked: true,
    validationCaseIds: [...previousSplit.validationCaseIds, ...additions.filter((item) => !testIds.has(item.id)).map((item) => item.id)],
    testCaseIds: [...previousSplit.testCaseIds, ...additions.filter((item) => testIds.has(item.id)).map((item) => item.id)],
  };
  const outputPath = path.resolve(readArg("--output", "docs/evaluation/golden-set.v4.json"));
  const splitPath = path.resolve(readArg("--split", "docs/evaluation/golden-set-splits.v4.json"));
  const checklistPath = path.resolve(readArg("--checklist", "docs/evaluation/HUMAN_REVIEW_CHECKLIST_V4.md"));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
  await fs.writeFile(splitPath, `${JSON.stringify(split, null, 2)}\n`);
  await fs.writeFile(checklistPath, renderChecklist(dataset, split));
  console.log(`BUILT ${dataset.id}@${dataset.version}: ${dataset.cases.length} cases.`);
  console.log(`Locked test: ${split.testCaseIds.length}; validation: ${split.validationCaseIds.length}.`);
}

function answerableCases(): GoldenCase[] {
  return [
    answerable("python-list-comprehension-001", "Python", "data-structures", "What are the main parts of a Python list comprehension, and what does it produce?", "factual", "medium",
      "A list comprehension places an expression inside brackets, followed by a for clause and optionally additional for or if clauses. It evaluates the expression for the selected items and produces a new list.",
      ["The expression is written inside brackets.", "It includes a for clause and may include additional for or if clauses.", "Its result is a newly created list."],
      "python-tutorial", "https://docs.python.org/3/tutorial/datastructures.html", "5.1.3 List Comprehensions"),
    answerable("python-default-argument-once-001", "Python", "functions", "Why can using a mutable object as a Python default argument cause values to persist across calls?", "factual", "medium",
      "Default argument values are evaluated only once, when the function is defined. A mutable default such as a list is therefore reused by later calls, so mutations made by one call remain visible to subsequent calls.",
      ["Defaults are evaluated at function definition time.", "The same mutable object is reused across calls.", "Mutations can therefore accumulate between calls."],
      "python-tutorial", "https://docs.python.org/3/tutorial/controlflow.html", "4.9.1 Default Argument Values"),
    answerable("python-parameter-kinds-001", "Python", "functions", "How do / and * divide positional-only, positional-or-keyword, and keyword-only parameters in a Python function definition?", "factual", "medium",
      "Parameters before / are positional-only. Parameters between / and * may be passed positionally or by keyword. Parameters after * are keyword-only.",
      ["Parameters before / are positional-only.", "Parameters between the separators accept either calling style.", "Parameters after * are keyword-only."],
      "python-language-reference", "https://docs.python.org/3/reference/compound_stmts.html", "Function definitions and parameter lists"),
    answerable("typescript-discriminated-union-001", "TypeScript", "type-system", "How does a common literal discriminant let TypeScript narrow a union?", "factual", "medium",
      "When every union member has a common property with distinct literal types, checking that property eliminates incompatible members. Inside each branch TypeScript narrows the value to the matching union member.",
      ["Union members share a discriminant property.", "The discriminant uses distinct literal types.", "Checking it narrows the value to the compatible member."],
      "typescript-handbook", "https://www.typescriptlang.org/docs/handbook/2/narrowing.html", "Discriminated unions"),
    answerable("typescript-conditional-distribution-001", "TypeScript", "type-system", "When does a TypeScript conditional type distribute over a union, and how can that behavior be prevented?", "comparative", "hard",
      "A conditional type distributes when its checked type is a naked generic type parameter and it receives a union, applying the conditional to each member. Wrapping both sides of extends in single-element tuple types prevents distribution.",
      ["A generic conditional type distributes over union members.", "Each union member is processed separately.", "Tuple-wrapping the checked and constraint types prevents distribution."],
      "typescript-handbook", "https://www.typescriptlang.org/docs/handbook/2/conditional-types.html", "Distributive Conditional Types"),
    answerable("typescript-keyof-001", "TypeScript", "type-system", "What type does TypeScript's keyof operator produce for an object type?", "factual", "medium",
      "keyof produces a union of the object's known property keys as string or numeric literal types; index signatures can broaden the result to string, number, or both.",
      ["keyof returns a union of property keys.", "Known keys appear as literal types.", "Index signatures may broaden the result to string or number."],
      "typescript-handbook", "https://www.typescriptlang.org/docs/handbook/2/keyof-types.html", "The keyof type operator"),
    answerable("rust-ownership-move-clone-001", "Rust", "ownership", "What is the difference between moving and cloning a heap-owning Rust value such as String?", "comparative", "medium",
      "A move transfers ownership and makes the previous binding unusable, without duplicating the heap data. clone performs an explicit deep copy, so both bindings remain independently usable.",
      ["A move transfers ownership.", "The previous binding cannot be used after the move.", "clone duplicates heap data so both values remain usable."],
      "rust-book", "https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html", "Variables and Data Interacting with Move and Clone"),
    answerable("rust-mutable-reference-rules-001", "Rust", "borrowing", "What restrictions apply while a mutable Rust reference to a value is active?", "factual", "medium",
      "Only one mutable reference to that value may be active, and immutable references to the same value cannot overlap it. These restrictions prevent data races at compile time.",
      ["Only one active mutable reference is allowed.", "Mutable and immutable references to the same value cannot overlap.", "The restrictions prevent data races."],
      "rust-book", "https://doc.rust-lang.org/stable/book/ch04-02-references-and-borrowing.html", "Mutable References"),
    answerable("rust-question-mark-result-001", "Rust", "error-handling", "What does Rust's ? operator do when applied to a Result?", "factual", "medium",
      "For Ok it extracts the contained value and continues. For Err it returns early from the current function, converting the error through From when necessary, so the enclosing function must have a compatible return type.",
      ["Ok values are unwrapped for continued execution.", "Err causes an early return.", "The error may be converted through From and the function return type must be compatible."],
      "rust-book", "https://doc.rust-lang.org/stable/book/ch09-02-recoverable-errors-with-result.html", "The ? Operator Shortcut"),
  ];
}

function negativeCases(): GoldenCase[] {
  return [
    negative("python-pandas-groupby-001", "Python", "How do pandas GroupBy.transform and named aggregation differ when returning grouped results?", "The corpus contains Python language documentation, not the pandas API.", ["pandas.DataFrame.groupby", "GroupBy.transform", "pd.NamedAgg"]),
    negative("python-sqlalchemy-async-001", "Python", "How should SQLAlchemy AsyncSession combine selectinload with an asynchronous transaction?", "The corpus contains Python language documentation, not SQLAlchemy documentation.", ["sqlalchemy.ext.asyncio", "AsyncSession", "selectinload"]),
    negative("python-celery-retry-001", "Python", "How do Celery task acks_late and apply_async affect retries and delivery acknowledgement?", "The corpus contains Python language documentation, not Celery documentation.", ["Celery.task", "apply_async", "acks_late"]),
    negative("typescript-deno-permissions-001", "TypeScript", "How does Deno.serve behave when network permission has not been granted?", "The corpus contains TypeScript language documentation, not Deno runtime documentation.", ["Deno.serve", "Deno.permissions", "npm: specifier"]),
    negative("typescript-vite-glob-001", "TypeScript", "How does Vite transform import.meta.glob and configure its eager option?", "The corpus contains TypeScript language documentation, not Vite documentation.", ["import.meta.glob", "vite.config.ts", "defineConfig"]),
    negative("typescript-prisma-transaction-001", "TypeScript", "How does PrismaClient $transaction coordinate interactive transactions and relationLoadStrategy?", "The corpus contains TypeScript language documentation, not Prisma ORM documentation.", ["PrismaClient", "$transaction", "relationLoadStrategy"]),
    negative("rust-axum-state-001", "Rust", "How does axum::Router extract shared State and convert handler failures into IntoResponse?", "The corpus contains Rust language documentation, not the Axum framework API.", ["axum::Router", "IntoResponse", "State<AppState>"]),
    negative("rust-bevy-query-001", "Rust", "How does Bevy ECS query mutable Transform components while filtering by Changed<T>?", "The corpus contains Rust language documentation, not the Bevy engine API.", ["derive(Component)", "bevy_ecs", "Query<(&Transform"]),
    negative("rust-diesel-querydsl-001", "Rust", "How do Diesel QueryDsl and RunQueryDsl construct and execute a typed SQL query?", "The corpus contains Rust language documentation, not Diesel ORM documentation.", ["diesel::table!", "RunQueryDsl", "QueryDsl"]),
  ];
}

function repairInheritedNegativeProbe(item: GoldenCase): GoldenCase {
  if (item.id === "postgresql-19-release-001" && item.negativeVerification) {
    return { ...item, negativeVerification: { ...item.negativeVerification, absenceProbes: ["PostgreSQL 19.0 release notes", "PostgreSQL version 19 beta", "Release 19 documentation"] } };
  }
  if (item.id === "rust-serde-custom-001" && item.negativeVerification) {
    return { ...item, negativeVerification: { ...item.negativeVerification, absenceProbes: ["serde(deserialize_with", "serde::Deserializer", "Serializer::serialize_struct"] } };
  }
  return item;
}

function answerable(id: string, language: string, domain: string, question: string, questionType: GoldenQuestionType, difficulty: "medium" | "hard", answer: string, keyFacts: string[], sourceId: string, sourceUrl: string, section: string): GoldenCase {
  return { id, status: "source-verified", language, domain, question, answerability: "answerable", difficulty, questionType, expected: { answer, keyFacts }, evidence: [{ sourceId, sourceUrl, section }], tags: [language.toLowerCase(), domain, "html-snapshot", "v4"], notes: "Verified against the locally acquired multipage HTML snapshot; independent user confirmation pending.", authoredBy: "codex-assisted-curation", verifiedBy: "local-html-snapshot-inspection", verifiedAt: reviewedAt };
}

function negative(id: string, language: string, question: string, scopeBasis: string, absenceProbes: string[]): GoldenCase {
  const category: GoldenNegativeCategory = "adjacent-technology";
  return { id, status: "source-verified", language, domain: "adjacent-technology", question, answerability: "unanswerable", difficulty: "hard", questionType: "unanswerable", expected: { keyFacts: [], refusalReason: scopeBasis }, evidence: [], tags: ["negative", "hard-negative", category, language.toLowerCase(), "v4"], negativeVerification: { category, scopeBasis, absenceProbes }, authoredBy: "codex-assisted-curation", verifiedBy: "corpus-scope-and-absence-probe", verifiedAt: reviewedAt };
}

function provisionalApproval(item: GoldenCase): GoldenCase {
  return { ...item, status: "human-approved", approval: { state: "pending-confirmation", approvedBy: "user-delegated-ai-review", approvedAt: reviewedAt, basis: "Operational approval requested by the user after source/corpus verification; the user will independently confirm the case before final thesis reporting." } };
}

function renderChecklist(dataset: GoldenSet, split: GoldenSetSplit) {
  const testIds = new Set(split.testCaseIds);
  return `# Human review checklist - benchmark v4\n\nThe v4 benchmark adds positive Python, TypeScript, and Rust cases after multipage HTML acquisition. All v3 assignments are preserved. The 24-case test remains locked and must not be executed before independent confirmation and protocol freeze.\n\n| Confirm | Case | Split | Answerability | Language | Evidence or negative basis |\n|---|---|---|---|---|---|\n${dataset.cases.map((item) => `| [ ] | \`${item.id}\` | ${testIds.has(item.id) ? "test" : "validation"} | ${item.answerability} | ${item.language} | ${item.answerability === "answerable" ? item.evidence.map((evidence) => `${evidence.sourceId ?? evidence.sourceUrl}: ${evidence.section ?? "document"}`).join("; ") : item.negativeVerification?.scopeBasis} |`).join("\n")}\n`;
}

function readArg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
