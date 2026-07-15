import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ExperimentConfig } from "./experiment-types";
import { loadGoldenSet, validateGoldenSet, type GoldenCaseStatus } from "./golden-set";

export type BenchmarkMetric = {
  name: string;
  role: "primary" | "secondary" | "guardrail";
  direction: "higher" | "lower" | "context";
  description: string;
};

export type BenchmarkReadinessRule = {
  caseStatuses: GoldenCaseStatus[];
  minimumCases: number;
  requiredLanguages: string[];
};

export type BenchmarkSuite = {
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  baselineExperiment: string;
  experimentConfigs: string[];
  allowedVariablePaths: string[];
  metrics: BenchmarkMetric[];
  readiness: {
    exploratory: BenchmarkReadinessRule;
    thesis: BenchmarkReadinessRule;
  };
  reportOutput: string;
};

export type BenchmarkInspection = {
  schemaVersion: 1;
  suiteId: string;
  valid: boolean;
  protocolHash: string;
  suitePath: string;
  baselineExperiment: string;
  allowedVariablePaths: string[];
  errors: string[];
  warnings: string[];
  inputs: Array<{ kind: "suite" | "experiment" | "manifest" | "golden-set"; path: string; sha256: string }>;
  experiments: Array<{
    id: string;
    path: string;
    configHash: string;
    baseline: boolean;
    changedPaths: string[];
    targetWords: number;
    minWords: number;
    overlapWords: number;
  }>;
  metrics: BenchmarkMetric[];
  readiness: {
    exploratory: BenchmarkReadinessResult;
    thesis: BenchmarkReadinessResult;
  };
};

type BenchmarkReadinessResult = {
  ready: boolean;
  selectedCases: number;
  minimumCases: number;
  includedLanguages: string[];
  missingLanguages: string[];
  caseStatuses: GoldenCaseStatus[];
};

type LoadedExperiment = {
  path: string;
  raw: string;
  config: ExperimentConfig;
};

const METADATA_PATHS = new Set(["id", "title", "hypothesis", "tags"]);

export async function inspectBenchmarkSuite(inputPath: string): Promise<BenchmarkInspection> {
  const suitePath = path.resolve(inputPath);
  const suiteRaw = await fs.readFile(suitePath, "utf8");
  const suite = JSON.parse(suiteRaw) as BenchmarkSuite;
  const errors: string[] = [];
  const warnings: string[] = [];
  validateSuiteShape(suite, errors);

  const suiteDirectory = path.dirname(suitePath);
  const loadedExperiments = await Promise.all(
    (suite.experimentConfigs ?? []).map(async (configPath) => {
      const absolutePath = path.resolve(suiteDirectory, configPath);
      const raw = await fs.readFile(absolutePath, "utf8");
      return { path: absolutePath, raw, config: JSON.parse(raw) as ExperimentConfig };
    }),
  );
  validateExperiments(suite, loadedExperiments, errors);

  const baseline = loadedExperiments.find((item) => item.config.id === suite.baselineExperiment);
  const experimentRows = loadedExperiments.map((item) => {
    const changedPaths = baseline && item !== baseline ? diffExperimentConfigs(baseline.config, item.config) : [];
    return {
      id: item.config.id,
      path: projectPath(item.path),
      configHash: sha256(item.raw),
      baseline: item.config.id === suite.baselineExperiment,
      changedPaths,
      targetWords: item.config.chunking.targetWords,
      minWords: item.config.chunking.minWords,
      overlapWords: item.config.chunking.overlapWords,
    };
  });

  const inputs: BenchmarkInspection["inputs"] = [
    { kind: "suite", path: projectPath(suitePath), sha256: sha256(suiteRaw) },
    ...loadedExperiments.map((item) => ({
      kind: "experiment" as const,
      path: projectPath(item.path),
      sha256: sha256(item.raw),
    })),
  ];

  const referenceConfig = baseline?.config ?? loadedExperiments[0]?.config;
  const manifestPaths = referenceConfig?.corpus.manifests ?? [];
  for (const manifestPath of manifestPaths) {
    const absolutePath = path.resolve(manifestPath);
    inputs.push({ kind: "manifest", path: projectPath(absolutePath), sha256: sha256(await fs.readFile(absolutePath)) });
  }

  let readiness = emptyReadiness(suite);
  const goldenSetPath = referenceConfig?.evaluation.goldenSet;
  if (!goldenSetPath) {
    errors.push("The common benchmark requires evaluation.goldenSet in every experiment.");
  } else {
    const absolutePath = path.resolve(goldenSetPath);
    const goldenRaw = await fs.readFile(absolutePath, "utf8");
    inputs.push({ kind: "golden-set", path: projectPath(absolutePath), sha256: sha256(goldenRaw) });
    const goldenSet = await loadGoldenSet(absolutePath);
    const validation = await validateGoldenSet(goldenSet);
    errors.push(...validation.errors.map((error) => `Golden set: ${error}`));
    warnings.push(...validation.warnings.map((warning) => `Golden set: ${warning}`));
    if (!sameStringSet(goldenSet.corpusManifests, manifestPaths)) {
      errors.push("Golden-set corpusManifests must match the benchmark corpus manifests exactly.");
    }
    readiness = {
      exploratory: evaluateReadiness(goldenSet.cases, suite.readiness.exploratory),
      thesis: evaluateReadiness(goldenSet.cases, suite.readiness.thesis),
    };
    if (!readiness.exploratory.ready) warnings.push(renderReadinessWarning("Exploratory", readiness.exploratory));
    if (!readiness.thesis.ready) warnings.push(renderReadinessWarning("Thesis", readiness.thesis));
  }

  const protocolHash = sha256(
    inputs
      .map((input) => `${input.kind}\0${input.path}\0${input.sha256}`)
      .sort()
      .join("\n"),
  );
  return {
    schemaVersion: 1,
    suiteId: suite.id,
    valid: errors.length === 0,
    protocolHash,
    suitePath: projectPath(suitePath),
    baselineExperiment: suite.baselineExperiment,
    allowedVariablePaths: suite.allowedVariablePaths,
    errors,
    warnings,
    inputs,
    experiments: experimentRows,
    metrics: suite.metrics,
    readiness,
  };
}

export function diffExperimentConfigs(baseline: ExperimentConfig, candidate: ExperimentConfig) {
  return diffValues(baseline, candidate).filter((changedPath) => !METADATA_PATHS.has(changedPath));
}

export function findUncontrolledExperimentPaths(
  baseline: ExperimentConfig,
  candidate: ExperimentConfig,
  allowedVariablePaths: string[],
) {
  return diffExperimentConfigs(baseline, candidate).filter(
    (changedPath) => !allowedVariablePaths.includes(changedPath),
  );
}

export function renderBenchmarkMarkdown(inspection: BenchmarkInspection) {
  const experimentRows = inspection.experiments.map(
    (experiment) =>
      `| ${experiment.id} | ${experiment.baseline ? "yes" : "no"} | ${experiment.targetWords} | ${experiment.minWords} | ${experiment.overlapWords} | ${experiment.changedPaths.join(", ") || "-"} | ${experiment.configHash.slice(0, 8)} |`,
  );
  const metricRows = inspection.metrics.map(
    (metric) => `| ${metric.name} | ${metric.role} | ${metric.direction} | ${metric.description} |`,
  );
  return `# Common benchmark readiness

- Suite: \`${inspection.suiteId}\`
- Protocol hash: \`${inspection.protocolHash}\`
- Valid configuration: **${inspection.valid ? "yes" : "no"}**
- Baseline: \`${inspection.baselineExperiment}\`
- Allowed experimental variable: ${inspection.allowedVariablePaths.map((item) => `\`${item}\``).join(", ")}

## Controlled experiments

| Experiment | Baseline | Target words | Minimum words | Overlap words | Changed paths | Config hash |
|---|---|---:|---:|---:|---|---|
${experimentRows.join("\n")}

## Metrics

| Metric | Role | Direction | Purpose |
|---|---|---|---|
${metricRows.join("\n")}

## Dataset readiness

| Use | Ready | Selected cases | Minimum | Included languages | Missing required languages | Review states |
|---|---|---:|---:|---|---|---|
${renderReadinessRow("Exploratory", inspection.readiness.exploratory)}
${renderReadinessRow("Thesis", inspection.readiness.thesis)}

## Validation findings

### Errors

${inspection.errors.length ? inspection.errors.map((item) => `- ${item}`).join("\n") : "- None."}

### Warnings

${inspection.warnings.length ? inspection.warnings.map((item) => `- ${item}`).join("\n") : "- None."}

The protocol hash covers the suite, experiment definitions, corpus manifests, and golden set. Any change to these inputs creates a different benchmark protocol.
`;
}

function validateSuiteShape(suite: BenchmarkSuite, errors: string[]) {
  if (suite.schemaVersion !== 1) errors.push("Benchmark suite schemaVersion must be 1.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(suite.id ?? "")) errors.push("Benchmark suite id must use lowercase kebab-case.");
  if (!suite.title?.trim() || !suite.objective?.trim()) errors.push("Benchmark suite title and objective are required.");
  if (!Array.isArray(suite.experimentConfigs) || suite.experimentConfigs.length < 2) {
    errors.push("A benchmark suite requires at least two experiment configurations.");
  }
  if (!Array.isArray(suite.allowedVariablePaths) || !suite.allowedVariablePaths.length) {
    errors.push("allowedVariablePaths must declare at least one isolated variable.");
  }
  const primaryMetrics = (suite.metrics ?? []).filter((metric) => metric.role === "primary");
  if (primaryMetrics.length !== 1) errors.push("A benchmark suite must define exactly one primary metric.");
  for (const name of ["exploratory", "thesis"] as const) {
    const rule = suite.readiness?.[name];
    if (!rule || !Array.isArray(rule.caseStatuses) || !Number.isInteger(rule.minimumCases) || rule.minimumCases < 1) {
      errors.push(`readiness.${name} must define caseStatuses and a positive minimumCases.`);
    }
  }
}

function validateExperiments(suite: BenchmarkSuite, experiments: LoadedExperiment[], errors: string[]) {
  const ids = new Set<string>();
  for (const item of experiments) {
    const config = item.config;
    if (config.schemaVersion !== 1) errors.push(`${projectPath(item.path)}: schemaVersion must be 1.`);
    if (ids.has(config.id)) errors.push(`Duplicate experiment id '${config.id}'.`);
    ids.add(config.id);
  }
  const baseline = experiments.find((item) => item.config.id === suite.baselineExperiment);
  if (!baseline) {
    errors.push(`Baseline experiment '${suite.baselineExperiment}' is not listed in experimentConfigs.`);
    return;
  }
  for (const candidate of experiments) {
    if (candidate === baseline) continue;
    const changedPaths = diffExperimentConfigs(baseline.config, candidate.config);
    if (!changedPaths.length) errors.push(`Experiment '${candidate.config.id}' does not change any measured variable.`);
    const uncontrolled = findUncontrolledExperimentPaths(
      baseline.config,
      candidate.config,
      suite.allowedVariablePaths,
    );
    if (uncontrolled.length) {
      errors.push(`Experiment '${candidate.config.id}' changes uncontrolled path(s): ${uncontrolled.join(", ")}.`);
    }
  }
}

function diffValues(left: unknown, right: unknown, prefix = ""): string[] {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right) ? [] : [prefix];
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.flatMap((key) => diffValues(left[key], right[key], prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

function evaluateReadiness(
  cases: Array<{ status: GoldenCaseStatus; language: string }>,
  rule: BenchmarkReadinessRule,
): BenchmarkReadinessResult {
  const selected = cases.filter((testCase) => rule.caseStatuses.includes(testCase.status));
  const includedLanguages = [...new Set(selected.map((testCase) => testCase.language))].sort();
  const missingLanguages = rule.requiredLanguages.filter((language) => !includedLanguages.includes(language)).sort();
  return {
    ready: selected.length >= rule.minimumCases && missingLanguages.length === 0,
    selectedCases: selected.length,
    minimumCases: rule.minimumCases,
    includedLanguages,
    missingLanguages,
    caseStatuses: rule.caseStatuses,
  };
}

function emptyReadiness(suite: BenchmarkSuite) {
  const empty = (rule: BenchmarkReadinessRule): BenchmarkReadinessResult => ({
    ready: false,
    selectedCases: 0,
    minimumCases: rule?.minimumCases ?? 0,
    includedLanguages: [],
    missingLanguages: rule?.requiredLanguages ?? [],
    caseStatuses: rule?.caseStatuses ?? [],
  });
  return { exploratory: empty(suite.readiness?.exploratory), thesis: empty(suite.readiness?.thesis) };
}

function renderReadinessWarning(label: string, result: BenchmarkReadinessResult) {
  const missing = result.missingLanguages.length ? ` Missing languages: ${result.missingLanguages.join(", ")}.` : "";
  return `${label} dataset is not ready: ${result.selectedCases}/${result.minimumCases} required cases.${missing}`;
}

function renderReadinessRow(label: string, result: BenchmarkReadinessResult) {
  return `| ${label} | ${result.ready ? "yes" : "no"} | ${result.selectedCases} | ${result.minimumCases} | ${result.includedLanguages.join(", ") || "-"} | ${result.missingLanguages.join(", ") || "-"} | ${result.caseStatuses.join(", ")} |`;
}

function sameStringSet(left: string[], right: string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function projectPath(filePath: string) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
}

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
