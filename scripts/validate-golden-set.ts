import { loadGoldenSet, loadGoldenSetSplit, validateGoldenSet, validateGoldenSetSplit } from "../src/lib/rag/golden-set";

async function main() {
  const filePath = readDatasetPath(process.argv.slice(2));
  const dataset = await loadGoldenSet(filePath);
  const result = await validateGoldenSet(dataset);
  for (const warning of result.warnings) console.warn(`WARNING ${warning}`);
  if (result.errors.length) {
    for (const error of result.errors) console.error(`ERROR ${error}`);
    throw new Error(`Golden set validation failed with ${result.errors.length} error(s).`);
  }
  const splitPath = readOption(process.argv.slice(2), "--split");
  if (splitPath) {
    const split = await loadGoldenSetSplit(splitPath);
    const splitResult = validateGoldenSetSplit(dataset, split);
    for (const warning of splitResult.warnings) console.warn(`WARNING ${warning}`);
    if (splitResult.errors.length) {
      for (const error of splitResult.errors) console.error(`ERROR ${error}`);
      throw new Error(`Golden split validation failed with ${splitResult.errors.length} error(s).`);
    }
    console.log(`VALID SPLIT ${split.id}@${split.version}: validation=${split.validationCaseIds.length}, test=${split.testCaseIds.length}.`);
  }
  console.log(`VALID ${dataset.id}@${dataset.version}: ${dataset.cases.length} case(s), ${result.warnings.length} warning(s).`);
}

function readDatasetPath(args: string[]) {
  const index = args.findIndex((arg) => arg === "--dataset" || arg === "-d");
  const filePath = index >= 0 ? args[index + 1] : undefined;
  if (!filePath) throw new Error("Usage: tsx scripts/validate-golden-set.ts --dataset <golden-set.json>");
  return filePath;
}

function readOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
