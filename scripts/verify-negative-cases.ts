import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { loadGoldenSet } from "../src/lib/rag/golden-set";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const chunksPath = path.resolve(options.chunks);
  const chunksRaw = await fs.readFile(chunksPath, "utf8");
  const corpusText = chunksRaw.toLocaleLowerCase("en");
  const dataset = await loadGoldenSet(options.dataset);
  const cases = dataset.cases.filter((item) => item.status !== "draft" && item.answerability === "unanswerable");
  const results = cases.map((item) => {
    const probes = (item.negativeVerification?.absenceProbes ?? []).map((probe) => ({
      probe,
      found: corpusText.includes(probe.toLocaleLowerCase("en")),
    }));
    return { id: item.id, category: item.negativeVerification?.category ?? "unclassified", probes };
  });
  const found = results.flatMap((item) => item.probes.filter((probe) => probe.found).map((probe) => `${item.id}: ${probe.probe}`));
  const report = `# Negative-case corpus verification\n\n- Dataset: \`${dataset.id}@${dataset.version}\`\n- Corpus snapshot: \`${sha256(chunksRaw)}\`\n- Negative cases: **${cases.length}**\n- Absence probes: **${results.reduce((total, item) => total + item.probes.length, 0)}**\n- Unexpected probe matches: **${found.length}**\n\n| Case | Category | Probes | Result |\n|---|---|---|---|\n${results.map((item) => `| ${item.id} | ${item.category} | ${item.probes.map((probe) => `\`${probe.probe}\``).join(", ")} | ${item.probes.some((probe) => probe.found) ? "review required" : "no exact match"} |`).join("\n")}\n\nExact-string absence is a reproducible sanity check, not semantic proof by itself. Source-manifest scope and the recorded scope basis remain the primary justification for classifying a question as unanswerable.\n`;
  const output = path.resolve(options.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, report);
  console.log(`Wrote ${output}`);
  if (found.length) throw new Error(`Unexpected corpus matches:\n${found.join("\n")}`);
}

function parseArgs(args: string[]) {
  const read = (name: string, fallback?: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const chunks = read("--chunks");
  if (!chunks) throw new Error("Usage: tsx scripts/verify-negative-cases.ts --chunks <chunks.json>");
  return {
    chunks,
    dataset: read("--dataset", "docs/evaluation/golden-set.v1.json")!,
    output: read("--output", "docs/evaluation/negative-case-verification.md")!,
  };
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
