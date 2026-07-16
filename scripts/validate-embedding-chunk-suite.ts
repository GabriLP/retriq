import fs from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, unknown>;
type Suite = {
  schemaVersion: number;
  id: string;
  factors: { embeddingModel: string[]; "chunking.targetWords": number[] };
  candidates: string[];
  split: string;
};

const allowedChangedPaths = ["embedding.provider", "embedding.model", "embedding.pricing", "chunking.targetWords"];

async function main() {
  const suitePath = path.resolve(readArg("--suite", "docs/experiments/embedding-chunk-interaction.v1.json"));
  const suite = JSON.parse(await fs.readFile(suitePath, "utf8")) as Suite;
  const errors: string[] = [];
  if (suite.schemaVersion !== 1) errors.push("Suite schemaVersion must be 1.");
  const expectedCells = new Set(
    suite.factors.embeddingModel.flatMap((model) => suite.factors["chunking.targetWords"].map((words) => `${model}/${words}`)),
  );
  const observedCells = new Set<string>();
  const configs: Array<{ file: string; config: JsonObject }> = [];
  for (const file of suite.candidates) {
    configs.push({ file, config: JSON.parse(await fs.readFile(path.resolve(path.dirname(suitePath), file), "utf8")) as JsonObject });
  }
  const baseline = configs[0]?.config;
  for (const { file, config } of configs) {
    const embedding = objectValue(config.embedding);
    const chunking = objectValue(config.chunking);
    const evaluation = objectValue(config.evaluation);
    const provider = stringValue(embedding.provider);
    const model = stringValue(embedding.model);
    const targetWords = numberValue(chunking.targetWords);
    const cell = `${provider}/${model}/${targetWords}`;
    if (observedCells.has(cell)) errors.push(`${file}: duplicate factorial cell ${cell}.`);
    observedCells.add(cell);
    if (numberValue(embedding.outputDimensionality) !== 1024) errors.push(`${file}: outputDimensionality must be 1024.`);
    if (evaluation.split !== suite.split) errors.push(`${file}: evaluation split must be ${suite.split}.`);
    if (baseline) {
      const unexpected = diffPaths(stripIdentity(baseline), stripIdentity(config)).filter(
        (candidatePath) => !allowedChangedPaths.some((allowed) => candidatePath === allowed || candidatePath.startsWith(`${allowed}.`)),
      );
      if (unexpected.length) errors.push(`${file}: uncontrolled changes: ${unexpected.join(", ")}.`);
    }
  }
  for (const expected of expectedCells) if (!observedCells.has(expected)) errors.push(`Missing factorial cell ${expected}.`);
  for (const observed of observedCells) if (!expectedCells.has(observed)) errors.push(`Unexpected factorial cell ${observed}.`);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`VALID ${suite.id}: ${observedCells.size}/${expectedCells.size} factorial cells, controlled at 1024 dimensions.`);
}

function stripIdentity(value: JsonObject) {
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
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap((key) =>
    diffPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key),
  );
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown) {
  return isObject(value) ? value : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number.NaN;
}

function readArg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
