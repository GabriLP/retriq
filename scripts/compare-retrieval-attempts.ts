import fs from "node:fs/promises";
import path from "node:path";

type Attempt = {
  attemptId: string;
  status: string;
  createdAt: string;
  experimentId: string;
  parentRunId: string;
  code: { gitCommit: string; dirty: boolean };
  configuration: { embeddingModel: string; topK: number; minScore: number };
  corpus: { chunks: number };
  caseSelection: { selected: number };
  timingsMs?: { embedding: number; total: number };
  metrics?: {
    recallAtK: number | null;
    precisionAtK: number | null;
    mrr: number | null;
    ndcgAtK: number | null;
    noAnswerFalsePositiveRate: number | null;
  };
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const files = await findNamedFiles(root, "attempt.json");
  const invalidated = await loadInvalidatedAttempts(root);
  const attempts = (
    await Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(file, "utf8")) as Attempt))
  )
    .filter((attempt) => attempt.status === "completed" && attempt.metrics && !invalidated.has(attempt.attemptId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestByExperiment = new Map<string, Attempt>();
  for (const attempt of attempts) latestByExperiment.set(attempt.experimentId, attempt);
  const selected = [...latestByExperiment.values()].sort((left, right) => left.experimentId.localeCompare(right.experimentId));
  if (!selected.length) throw new Error(`No valid completed retrieval attempts found under ${root}.`);

  const outputBase = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputBase), { recursive: true });
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(selected, invalidated.size));
  await fs.writeFile(`${outputBase}.csv`, renderCsv(selected));
  console.log(`Compared ${selected.length} latest valid attempt(s); ${invalidated.size} invalidated attempt(s) excluded.`);
}

async function findNamedFiles(directory: string, name: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return findNamedFiles(fullPath, name);
        return Promise.resolve(entry.name === name ? [fullPath] : []);
      }),
    )
  ).flat();
}

async function loadInvalidatedAttempts(root: string) {
  const files = await findNamedFiles(root, "corrections.jsonl");
  const ids = new Set<string>();
  for (const file of files) {
    const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const correction = JSON.parse(line) as { attemptId?: string; disposition?: string };
      if (correction.attemptId && correction.disposition === "invalidated") ids.add(correction.attemptId);
    }
  }
  return ids;
}

function renderMarkdown(attempts: Attempt[], invalidatedCount: number) {
  const rows = attempts.map((attempt) => {
    const metric = attempt.metrics;
    return `| ${attempt.experimentId} | ${attempt.corpus.chunks} | ${attempt.configuration.embeddingModel} | ${attempt.configuration.topK} | ${format(metric?.recallAtK)} | ${format(metric?.precisionAtK)} | ${format(metric?.mrr)} | ${format(metric?.ndcgAtK)} | ${format(metric?.noAnswerFalsePositiveRate)} | ${attempt.timingsMs?.embedding ?? "—"} |`;
  });
  return `# Retrieval comparison

Generated: ${new Date().toISOString()}

> **Preliminary:** only source-verified seed cases are included. Final thesis tables require a larger human-approved set. ${invalidatedCount} invalidated attempt(s) were retained locally and excluded here.

| Experiment | Chunks | Embedding | k | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Embedding ms |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
${rows.join("\n")}

## Current interpretation

- Both word-window variants retrieve at least one expected source for every answerable seed case.
- The 450-word variant has higher chunk-level precision, while the 850-word baseline has higher MRR and nDCG on this small sample.
- Both variants retrieve unrelated context for the negative case at threshold 0.18, so threshold calibration and stronger abstention logic are required.
- No chunking choice is accepted yet: the sample is too small, does not yet cover the full PDF corpus, and has no human-approved cases.
`;
}

function renderCsv(attempts: Attempt[]) {
  const header = [
    "experiment_id", "attempt_id", "parent_run_id", "git_commit", "git_dirty", "chunks", "embedding_model",
    "top_k", "min_score", "cases", "recall_at_k", "precision_at_k", "mrr", "ndcg_at_k",
    "no_answer_false_positive_rate", "embedding_ms", "total_ms",
  ];
  const rows = attempts.map((attempt) => [
    attempt.experimentId, attempt.attemptId, attempt.parentRunId, attempt.code.gitCommit, attempt.code.dirty,
    attempt.corpus.chunks, attempt.configuration.embeddingModel, attempt.configuration.topK,
    attempt.configuration.minScore, attempt.caseSelection.selected, attempt.metrics?.recallAtK ?? "",
    attempt.metrics?.precisionAtK ?? "", attempt.metrics?.mrr ?? "", attempt.metrics?.ndcgAtK ?? "",
    attempt.metrics?.noAnswerFalsePositiveRate ?? "", attempt.timingsMs?.embedding ?? "", attempt.timingsMs?.total ?? "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function format(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toFixed(4);
}

function csvCell(value: unknown) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseArgs(args: string[]) {
  const rootIndex = args.findIndex((arg) => arg === "--root");
  const outputIndex = args.findIndex((arg) => arg === "--output");
  return {
    root: rootIndex >= 0 ? args[rootIndex + 1] : "data/experiments",
    output: outputIndex >= 0 ? args[outputIndex + 1] : "docs/experiment-results/retrieval-comparison",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
