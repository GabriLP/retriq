import fs from "node:fs/promises";
import path from "node:path";

import { loadGoldenSet, validateGoldenSet, type GoldenCase } from "../src/lib/rag/golden-set";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataset = await loadGoldenSet(options.dataset);
  const validation = await validateGoldenSet(dataset);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  const outputBase = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputBase), { recursive: true });
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(dataset.id, dataset.version, dataset.cases));
  await fs.writeFile(`${outputBase}.csv`, renderCsv(dataset.cases));
  console.log(`Wrote ${outputBase}.md and ${outputBase}.csv`);
}

function renderMarkdown(id: string, version: string, cases: GoldenCase[]) {
  const status = count(cases, (item) => item.status);
  const language = count(cases, (item) => item.language);
  const difficulty = count(cases, (item) => item.difficulty);
  const answerability = count(cases, (item) => item.answerability);
  return `# Golden set summary

- Dataset: \`${id}@${version}\`
- Cases: **${cases.length}**
- Scorable now: **${cases.filter((item) => item.status !== "draft" && item.status !== "retired").length}**

## Coverage

| Dimension | Distribution |
|---|---|
| Status | ${formatCounts(status)} |
| Language/domain | ${formatCounts(language)} |
| Difficulty | ${formatCounts(difficulty)} |
| Answerability | ${formatCounts(answerability)} |

## Case inventory

| Case | Status | Language | Difficulty | Type | Answerability |
|---|---|---|---|---|---|
${cases.map((item) => `| ${item.id} | ${item.status} | ${item.language} | ${item.difficulty} | ${item.questionType} | ${item.answerability} |`).join("\n")}

Draft cases are candidates only. A model or script may propose them, but they enter scored thesis measurements only after source verification and, for the final benchmark, human approval.
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
  return {
    dataset: datasetIndex >= 0 ? args[datasetIndex + 1] : "docs/evaluation/golden-set.v1.json",
    output: outputIndex >= 0 ? args[outputIndex + 1] : "docs/evaluation/golden-set-summary",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
