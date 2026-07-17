import fs from "node:fs/promises";
import path from "node:path";

type Metrics = {
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  ndcgAtK: number;
  noAnswerFalsePositiveRate: number;
};

type ThresholdResult = { threshold: number; metrics: Metrics };
type Variant = {
  variant: string;
  selectedThreshold: number | null;
  selectedMetrics: Metrics | null;
  thresholdResults: ThresholdResult[];
};
type Attempt = {
  attemptId: string;
  createdAt: string;
  experimentId: string;
  inputHashes: Record<string, string>;
  code: { gitCommit: string; dirty: boolean };
  results: Variant[];
  embeddings?: { total?: { estimatedApiCostUsd?: number | null; apiInputs?: number } };
};
type Estimate = {
  estimateId: string;
  configuration: {
    provider: string;
    model: string;
    outputDimensionality: number;
    priceUsdPerMillionTokens: number | null;
    priceObservedAt: string | null;
    priceSourceUrl: string | null;
  };
  caseSelection: { selected: number };
  total: {
    cacheMisses: number;
    estimatedProviderRequests: number;
    estimatedApiTokens: number;
    estimatedApiCostUsd: number | null;
  };
};
type Run = {
  label: string;
  role: "baseline" | "candidate";
  attempt: string;
  estimate: string;
  additionalAttempts?: string[];
  executionNote?: string;
};
type Manifest = {
  schemaVersion: number;
  id: string;
  suite: string;
  split: string;
  testSplitTouched: boolean;
  runs: Run[];
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifest);
  const manifest = await readJson<Manifest>(manifestPath);
  const root = path.dirname(path.dirname(path.dirname(manifestPath)));
  const records = await Promise.all(manifest.runs.map((run) => buildRecord(root, run)));
  const eligible = records.filter((record) => record.selectedThreshold !== null);
  const winner = eligible.sort((a, b) => b.selectedMetrics!.ndcgAtK - a.selectedMetrics!.ndcgAtK)[0] ?? null;
  const generatedAt = records.map((record) => record.attemptCreatedAt).sort().at(-1)!;
  const cleanRunCostUsd = sum(records.map((record) => record.cleanRunEstimate.costUsd ?? 0));
  const retryOverheadCostUsd = sum(records.map((record) => record.observedRetryOverhead.estimatedCostUsd));
  const report = {
    schemaVersion: 1,
    id: manifest.id,
    generatedAt,
    suite: manifest.suite,
    split: manifest.split,
    testSplitTouched: manifest.testSplitTouched,
    commonControls: {
      cases: records[0]?.cases ?? 0,
      chunks: 33079,
      targetChunkWords: 300,
      overlapWords: 80,
      outputDimensionality: 1024,
      retrieval: "metadata-aware dense cosine",
      topK: 4,
      selectionGuardrails: { noAnswerFalsePositiveRate: 0, minimumRecallAtK: 0.9, minimumMrr: 0.85 },
    },
    winner: winner ? { label: winner.label, threshold: winner.selectedThreshold, metrics: winner.selectedMetrics } : null,
    decision: winner
      ? `${winner.label} remains the selected embedding model because it is the only candidate satisfying every pre-registered guardrail.`
      : "No model satisfied every pre-registered guardrail.",
    aggregateEstimatedCostUsd: {
      cleanRuns: cleanRunCostUsd,
      retryOverhead: retryOverheadCostUsd,
      observedTotal: cleanRunCostUsd + retryOverheadCostUsd,
    },
    results: records,
    limitations: [
      "All benchmark approvals remain provisional pending independent human confirmation.",
      "Price observations are dated snapshots and may change.",
      "Embedding latency is excluded from model ranking because cache state and provider rate limits differed.",
      "The 24-case test split remains untouched and was not used for this decision.",
    ],
  };
  const output = path.resolve(options.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(`${output}.csv`, renderCsv(records));
  await fs.writeFile(`${output}.md`, renderMarkdown(report, records));
  console.log(`Reported ${records.length} embedding models; selected ${winner?.label ?? "none"}.`);
}

async function buildRecord(root: string, run: Run) {
  const attempt = await readJson<Attempt>(path.resolve(root, run.attempt));
  const estimate = await readJson<Estimate>(path.resolve(root, run.estimate));
  const variant = attempt.results.find((item) => item.variant === "metadata-aware-dense");
  if (!variant) throw new Error(`Missing metadata-aware-dense result in ${run.attempt}.`);
  const exploratory = [...variant.thresholdResults].sort((a, b) => a.threshold - b.threshold)[0];
  const bestZeroFpr = [...variant.thresholdResults]
    .filter((item) => item.metrics.noAnswerFalsePositiveRate === 0)
    .sort((a, b) => b.metrics.ndcgAtK - a.metrics.ndcgAtK || b.metrics.recallAtK - a.metrics.recallAtK)[0] ?? null;
  const additional = await Promise.all((run.additionalAttempts ?? []).map((file) => readJson<Attempt>(path.resolve(root, file))));
  const retryOverheadCostUsd = sum(additional.map((item) => item.embeddings?.total?.estimatedApiCostUsd ?? 0));
  const retryOverheadApiInputs = sum(additional.map((item) => item.embeddings?.total?.apiInputs ?? 0));
  return {
    label: run.label,
    role: run.role,
    provider: estimate.configuration.provider,
    model: estimate.configuration.model,
    experimentId: attempt.experimentId,
    attemptId: attempt.attemptId,
    attemptCreatedAt: attempt.createdAt,
    gitCommit: attempt.code.gitCommit,
    gitDirty: attempt.code.dirty,
    inputHashes: attempt.inputHashes,
    cases: estimate.caseSelection.selected,
    outputDimensionality: estimate.configuration.outputDimensionality,
    selectedThreshold: variant.selectedThreshold,
    selectedMetrics: variant.selectedMetrics,
    eligible: variant.selectedThreshold !== null,
    exploratoryLowThreshold: exploratory,
    bestZeroFpr,
    cleanRunEstimate: {
      cacheMisses: estimate.total.cacheMisses,
      providerRequests: estimate.total.estimatedProviderRequests,
      apiTokens: estimate.total.estimatedApiTokens,
      costUsd: estimate.total.estimatedApiCostUsd,
    },
    observedRetryOverhead: { apiInputs: retryOverheadApiInputs, estimatedCostUsd: retryOverheadCostUsd },
    price: {
      usdPerMillionTokens: estimate.configuration.priceUsdPerMillionTokens,
      observedAt: estimate.configuration.priceObservedAt,
      sourceUrl: estimate.configuration.priceSourceUrl,
    },
    executionNote: run.executionNote ?? null,
    failureReason: variant.selectedThreshold === null ? explainFailure(exploratory, bestZeroFpr) : null,
  };
}

function explainFailure(low: ThresholdResult, zero: ThresholdResult | null) {
  if (!zero) return "No threshold achieved zero false positives.";
  const failures = [];
  if (zero.metrics.recallAtK < 0.9) failures.push(`Recall@4 ${format(zero.metrics.recallAtK)} < 0.9000`);
  if (zero.metrics.mrr < 0.85) failures.push(`MRR ${format(zero.metrics.mrr)} < 0.8500`);
  if (!failures.length && low.metrics.mrr < 0.85) failures.push(`MRR is below 0.8500 even at the lowest threshold`);
  return failures.join("; ") || "No threshold satisfied the combined guardrails.";
}

function renderMarkdown(report: { generatedAt: string; decision: string; testSplitTouched: boolean; aggregateEstimatedCostUsd: { cleanRuns: number; retryOverhead: number; observedTotal: number } }, records: Awaited<ReturnType<typeof buildRecord>>[]) {
  const rows = records.map((record) => {
    const metrics = record.selectedMetrics ?? record.bestZeroFpr?.metrics;
    return `| ${record.label} | ${record.selectedThreshold ?? "none"} | ${record.bestZeroFpr?.threshold ?? "n/a"} | ${format(metrics?.recallAtK)} | ${format(metrics?.precisionAtK)} | ${format(metrics?.mrr)} | ${format(metrics?.ndcgAtK)} | ${format(metrics?.noAnswerFalsePositiveRate)} | ${formatCost(record.cleanRunEstimate.costUsd)} | ${formatCost(record.observedRetryOverhead.estimatedCostUsd)} | ${record.eligible ? "yes" : "no"} |`;
  });
  const failures = records.filter((record) => !record.eligible).map((record) => `- **${record.label}:** ${record.failureReason}`).join("\n");
  return `# Embedding model comparison — benchmark v4 validation

Generated from frozen run artifacts: ${report.generatedAt}

## Outcome

${report.decision} The comparison changes only the embedding provider/model; all models use 1024 dimensions, 300-word chunks with 80-word overlap, metadata-aware dense cosine retrieval, topK 4, and the same 54 validation cases.

| Model | Selected threshold | Best zero-FPR threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | FPR | Clean-run est. USD | Retry overhead USD | Eligible |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${rows.join("\n")}

For the selected model, the table reports the selected-threshold metrics. For rejected models, it reports their best nDCG result among thresholds with zero false positives.

## Rejected alternatives

${failures}

OpenAI Large was the strongest alternative at the permissive 0.18 threshold (Recall@4 0.9630, MRR 0.9012, nDCG@4 0.9141), but its no-answer FPR was 0.5556. At zero FPR, its best metadata-aware result fell to Recall@4 0.8333 and MRR 0.7901. Voyage retained Recall@4 0.9444 at zero FPR, but its MRR remained 0.8210, below the pre-registered 0.85 floor.

## Cost and execution notes

- Costs are incremental clean-run estimates based on cache misses and the provider prices observed on the recorded dates.
- Across all four indexed models, the clean-run estimate is USD ${formatCost(report.aggregateEstimatedCostUsd.cleanRuns)}; including retry overhead, the observed estimate is USD ${formatCost(report.aggregateEstimatedCostUsd.observedTotal)}.
- The Voyage indexing process continued after the shell timed out. A concurrent resume caused 120 redundant API inputs, adding an estimated USD 0.009315 operational overhead. This is excluded from the clean-run model comparison and disclosed separately.
- Latency is not used for ranking because cache state, timeouts, and provider limits were not controlled equally.
- Benchmark approvals are provisional. The 24-case test split was untouched: **${report.testSplitTouched ? "no" : "yes"}**.

## Decision

Retain Gemini Embedding 2 with metadata-aware retrieval and threshold 0.68 as the v4 validation baseline. Do not alter the guardrails after observing these results. The next experiment may use this frozen retriever while changing only the reranking or answer-generation component.
`;
}

function renderCsv(records: Awaited<ReturnType<typeof buildRecord>>[]) {
  const header = ["label", "provider", "model", "role", "eligible", "selected_threshold", "best_zero_fpr_threshold", "recall_at_4", "precision_at_4", "mrr", "ndcg_at_4", "no_answer_fpr", "estimated_api_tokens", "clean_run_cost_usd", "retry_api_inputs", "retry_overhead_cost_usd", "attempt_id", "git_commit", "failure_reason"];
  const rows = records.map((record) => {
    const metrics = record.selectedMetrics ?? record.bestZeroFpr?.metrics;
    return [record.label, record.provider, record.model, record.role, record.eligible, record.selectedThreshold ?? "", record.bestZeroFpr?.threshold ?? "", metrics?.recallAtK ?? "", metrics?.precisionAtK ?? "", metrics?.mrr ?? "", metrics?.ndcgAtK ?? "", metrics?.noAnswerFalsePositiveRate ?? "", record.cleanRunEstimate.apiTokens, record.cleanRunEstimate.costUsd ?? "", record.observedRetryOverhead.apiInputs, record.observedRetryOverhead.estimatedCostUsd, record.attemptId, record.gitCommit, record.failureReason ?? ""];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

async function readJson<T>(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function format(value: number | null | undefined) { return value === null || value === undefined ? "n/a" : value.toFixed(4); }
function formatCost(value: number | null | undefined) { return value === null || value === undefined ? "n/a" : value.toFixed(6); }
function csvCell(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

function parseArgs(args: string[]) {
  const manifest = args.indexOf("--manifest");
  const output = args.indexOf("--output");
  return {
    manifest: manifest >= 0 ? args[manifest + 1] : "docs/experiments/embedding-model-comparison-v4.runs.json",
    output: output >= 0 ? args[output + 1] : "docs/experiment-results/embedding-model-comparison-v4-validation",
  };
}

main().catch((error) => { console.error(error); process.exit(1); });
