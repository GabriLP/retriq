import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

type JsonObject = Record<string, unknown>;

type Suite = {
  schemaVersion: number;
  id: string;
  title: string;
  variedPaths: string[];
  commonDimension: number;
  candidates: string[];
  split: string;
};

type CandidateSummary = {
  id: string;
  file: string;
  provider: string;
  model: string;
  dimensions: number;
  priceUsdPerMillionInputTokens: number;
  priceObservedAt: string;
  priceSourceUrl: string;
  credentialEnvironmentVariable: string;
  credentialConfigured: boolean;
  configHash: string;
};

const credentialVariables: Record<string, string> = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  voyage: "VOYAGE_API_KEY",
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const suitePath = path.resolve(readArg("--suite", "docs/experiments/embedding-models.v1.json"));
  const write = process.argv.includes("--write");
  const suiteRaw = await fs.readFile(suitePath, "utf8");
  const suite = JSON.parse(suiteRaw) as Suite;
  const errors: string[] = [];
  if (suite.schemaVersion !== 1) errors.push("Suite schemaVersion must be 1.");
  if (!suite.candidates?.length) errors.push("Suite must contain at least one candidate.");
  const allowedVariedPaths = ["embedding.provider", "embedding.model", "embedding.pricing"];
  if (JSON.stringify(suite.variedPaths) !== JSON.stringify(allowedVariedPaths)) {
    errors.push(`variedPaths must be exactly ${allowedVariedPaths.join(", ")}.`);
  }

  const suiteDirectory = path.dirname(suitePath);
  const configs: Array<{ file: string; raw: string; config: JsonObject }> = [];
  for (const file of suite.candidates ?? []) {
    const absolutePath = path.resolve(suiteDirectory, file);
    const raw = await fs.readFile(absolutePath, "utf8");
    configs.push({ file, raw, config: JSON.parse(raw) as JsonObject });
  }

  const baseline = configs[0]?.config;
  const summaries: CandidateSummary[] = [];
  for (const item of configs) {
    const embedding = requiredObject(item.config.embedding, `${item.file}: embedding`, errors);
    const evaluation = requiredObject(item.config.evaluation, `${item.file}: evaluation`, errors);
    const pricing = requiredObject(embedding.pricing, `${item.file}: embedding.pricing`, errors);
    const provider = stringValue(embedding.provider);
    const credentialEnvironmentVariable = credentialVariables[provider] ?? "UNSUPPORTED_PROVIDER";
    const dimensions = numberValue(embedding.outputDimensionality);
    const observedAt = stringValue(pricing.observedAt);
    const sourceUrl = stringValue(pricing.sourceUrl);
    const price = numberValue(pricing.usdPerMillionInputTokens);

    if (!credentialVariables[provider]) errors.push(`${item.file}: unsupported provider '${provider}'.`);
    if (dimensions !== suite.commonDimension) errors.push(`${item.file}: output dimension ${dimensions} does not equal ${suite.commonDimension}.`);
    if (evaluation.split !== suite.split) errors.push(`${item.file}: split '${evaluation.split}' does not equal '${suite.split}'.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observedAt)) errors.push(`${item.file}: pricing.observedAt must use YYYY-MM-DD.`);
    if (!/^https:\/\//.test(sourceUrl)) errors.push(`${item.file}: pricing.sourceUrl must be an HTTPS URL.`);
    if (!(price >= 0)) errors.push(`${item.file}: pricing.usdPerMillionInputTokens must be non-negative.`);

    if (baseline) {
      const changed = diffPaths(stripCandidateIdentity(baseline), stripCandidateIdentity(item.config));
      const unexpected = changed.filter((candidatePath) => !allowedVariedPaths.some((allowed) => candidatePath === allowed || candidatePath.startsWith(`${allowed}.`)));
      if (unexpected.length) errors.push(`${item.file}: uncontrolled changes: ${unexpected.join(", ")}.`);
    }

    summaries.push({
      id: stringValue(item.config.id),
      file: item.file,
      provider,
      model: stringValue(embedding.model),
      dimensions,
      priceUsdPerMillionInputTokens: price,
      priceObservedAt: observedAt,
      priceSourceUrl: sourceUrl,
      credentialEnvironmentVariable,
      credentialConfigured: credentialEnvironmentVariable !== "UNSUPPORTED_PROVIDER" && Boolean(process.env[credentialEnvironmentVariable]?.trim()),
      configHash: sha256(item.raw),
    });
  }

  const report = {
    schemaVersion: 1,
    suiteId: suite.id,
    generatedAt: new Date().toISOString(),
    suiteHash: sha256(suiteRaw),
    valid: errors.length === 0,
    errors,
    controls: {
      commonDimension: suite.commonDimension,
      split: suite.split,
      variedPaths: suite.variedPaths,
      frozenPaths: ["corpus", "chunking", "retrieval", "evaluation", "generation"],
    },
    candidates: summaries,
  };

  if (write) {
    const outputBase = path.resolve("docs/experiment-results/embedding-model-readiness");
    await fs.mkdir(path.dirname(outputBase), { recursive: true });
    await fs.writeFile(`${outputBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(`${outputBase}.md`, renderMarkdown(report));
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`VALID ${suite.id}: ${summaries.length} controlled candidates at ${suite.commonDimension} dimensions.`);
  console.log(`Credentials ready: ${summaries.filter((item) => item.credentialConfigured).length}/${summaries.length}.`);
}

function stripCandidateIdentity(value: JsonObject) {
  const clone = structuredClone(value);
  delete clone.id;
  delete clone.title;
  delete clone.hypothesis;
  delete clone.tags;
  return clone;
}

function diffPaths(left: unknown, right: unknown, prefix = ""): string[] {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return [prefix || "<root>"];
    return left.flatMap((value, index) => diffPaths(value, right[index], `${prefix}[${index}]`));
  }
  if (!isObject(left) || !isObject(right)) return [prefix || "<root>"];
  const paths: string[] = [];
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    paths.push(...diffPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

function requiredObject(value: unknown, label: string, errors: string[]) {
  if (isObject(value)) return value;
  errors.push(`${label} must be an object.`);
  return {} as JsonObject;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number.NaN;
}

function renderMarkdown(report: {
  suiteId: string;
  generatedAt: string;
  valid: boolean;
  errors: string[];
  controls: { commonDimension: number; split: string; variedPaths: string[]; frozenPaths: string[] };
  candidates: CandidateSummary[];
}) {
  return `# Embedding model suite readiness\n\n- Suite: \`${report.suiteId}\`\n- Generated: ${report.generatedAt}\n- Controlled configuration: **${report.valid ? "valid" : "invalid"}**\n- Common dimension: **${report.controls.commonDimension}**\n- Dataset split: **${report.controls.split} only**\n- Varied paths: ${report.controls.variedPaths.map((item) => `\`${item}\``).join(", ")}\n- Frozen areas: ${report.controls.frozenPaths.join(", ")}\n\n| Provider | Model | Dimensions | USD / 1M input tokens | Price observed | Credential ready |\n|---|---|---:|---:|---|---|\n${report.candidates.map((item) => `| ${item.provider} | ${item.model} | ${item.dimensions} | ${item.priceUsdPerMillionInputTokens} | ${item.priceObservedAt} | ${item.credentialConfigured ? "yes" : `no (${item.credentialEnvironmentVariable})`} |`).join("\n")}\n\nPrices are dated configuration inputs with a source URL retained in the JSON artifact. Credential readiness records only presence, never secret values. This report performs no provider calls. Each model must receive an independently calibrated validation threshold before quality comparisons; the previously observed test split must not be reused for model selection.\n${report.errors.length ? `\n## Validation errors\n\n${report.errors.map((item) => `- ${item}`).join("\n")}\n` : ""}`;
}

function readArg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
