import { loadGoldenSet, validateGoldenSet } from "../src/lib/rag/golden-set";

async function main() {
  const filePath = readDatasetPath(process.argv.slice(2));
  const dataset = await loadGoldenSet(filePath);
  const result = await validateGoldenSet(dataset);
  for (const warning of result.warnings) console.warn(`WARNING ${warning}`);
  if (result.errors.length) {
    for (const error of result.errors) console.error(`ERROR ${error}`);
    throw new Error(`Golden set validation failed with ${result.errors.length} error(s).`);
  }
  console.log(`VALID ${dataset.id}@${dataset.version}: ${dataset.cases.length} case(s), ${result.warnings.length} warning(s).`);
}

function readDatasetPath(args: string[]) {
  const index = args.findIndex((arg) => arg === "--dataset" || arg === "-d");
  const filePath = index >= 0 ? args[index + 1] : undefined;
  if (!filePath) throw new Error("Usage: tsx scripts/validate-golden-set.ts --dataset <golden-set.json>");
  return filePath;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
