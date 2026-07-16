import fs from "node:fs/promises";
import path from "node:path";

import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, validateGoldenSet, validateGoldenSetSplit, type GoldenCase } from "../src/lib/rag/golden-set";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataset = await loadGoldenSet(options.dataset);
  const validation = await validateGoldenSet(dataset);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  const outputBase = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputBase), { recursive: true });
  const split = options.split ? await loadGoldenSetSplit(options.split) : undefined;
  if (split) {
    const splitValidation = validateGoldenSetSplit(dataset, split);
    if (splitValidation.errors.length) throw new Error(splitValidation.errors.join("\n"));
  }
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(dataset.id, dataset.version, dataset.cases, split));
  await fs.writeFile(`${outputBase}.csv`, renderCsv(dataset.cases));
  console.log(`Wrote ${outputBase}.md and ${outputBase}.csv`);
}

function renderMarkdown(id: string, version: string, cases: GoldenCase[], split?: Awaited<ReturnType<typeof loadGoldenSetSplit>>) {
  const status = count(cases, (item) => item.status);
  const language = count(cases, (item) => item.language);
  const difficulty = count(cases, (item) => item.difficulty);
  const answerability = count(cases, (item) => item.answerability);
  const approval = count(cases.filter((item) => item.status === "human-approved"), (item) => item.approval?.state ?? "provenance-missing");
  const negativeCategories = count(cases.filter((item) => item.answerability === "unanswerable"), (item) => item.negativeVerification?.category ?? "unclassified");
  const splitSection = split ? `\n## Validation/test split\n\n| Split | Cases | Answerable | Unanswerable | Locked |\n|---|---:|---:|---:|---|\n${(["validation", "test"] as const).map((name) => { const selected = selectGoldenSplit({ cases }, split, name); const answerable = selected.filter((item) => item.answerability === "answerable").length; return `| ${name} | ${selected.length} | ${answerable} | ${selected.length - answerable} | ${name === "test" ? (split.testLocked ? "yes" : "no") : "n/a"} |`; }).join("\n")}\n\nThe validation split is used for threshold and configuration selection. The locked test split is used once for the final unbiased estimate.\n` : "";
  return `# Golden set summary

- Dataset: \`${id}@${version}\`
- Cases: **${cases.length}**
- Operationally scorable: **${cases.filter((item) => item.status !== "draft" && item.status !== "retired").length}**
- Independently confirmed human approvals: **${cases.filter((item) => item.approval?.state === "confirmed").length}**

## Coverage

| Dimension | Distribution |
|---|---|
| Status | ${formatCounts(status)} |
| Language/domain | ${formatCounts(language)} |
| Difficulty | ${formatCounts(difficulty)} |
| Answerability | ${formatCounts(answerability)} |
| Approval state | ${formatCounts(approval)} |
| Negative category | ${formatCounts(negativeCategories)} |

${splitSection}

## Case inventory

| Case | Status | Language | Difficulty | Type | Answerability |
|---|---|---|---|---|---|
${cases.map((item) => `| ${item.id} | ${item.status} | ${item.language} | ${item.difficulty} | ${item.questionType} | ${item.answerability} |`).join("\n")}

Draft cases are candidates only. Provisional approvals may be used for engineering runs, but final thesis measurements require \`approval.state=confirmed\` after independent review.
`;
}

function renderCsv(cases: GoldenCase[]) {
  const rows = cases.map((item) => [
    item.id,
    item.status,
    item.language,
    item.domain,
    item.difficulty,
    item.questionType,
    item.answerability,
    item.question,
    item.evidence.length,
  ]);
  return [["id", "status", "language", "domain", "difficulty", "question_type", "answerability", "question", "evidence_count"], ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n") + "\n";
}

function count(cases: GoldenCase[], value: (item: GoldenCase) => string) {
  return cases.reduce<Record<string, number>>((result, item) => {
    const key = value(item);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

function formatCounts(values: Record<string, number>) {
  return Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}: ${value}`).join("; ");
}

function csvCell(value: unknown) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseArgs(args: string[]) {
  const datasetIndex = args.findIndex((arg) => arg === "--dataset" || arg === "-d");
  const outputIndex = args.findIndex((arg) => arg === "--output" || arg === "-o");
  const splitIndex = args.findIndex((arg) => arg === "--split" || arg === "-s");
  return {
    dataset: datasetIndex >= 0 ? args[datasetIndex + 1] : "docs/evaluation/golden-set.v1.json",
    output: outputIndex >= 0 ? args[outputIndex + 1] : "docs/evaluation/golden-set-summary",
    split: splitIndex >= 0 ? args[splitIndex + 1] : "docs/evaluation/golden-set-splits.v1.json",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
