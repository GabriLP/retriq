import fs from "node:fs/promises";
import path from "node:path";

type Status = "planned" | "in-progress" | "completed" | "superseded";
type Entry = {
  order: number;
  id: string;
  thesisSection: string;
  researchQuestion: string;
  status: Status;
  variable: string;
  controls: string[];
  metrics: string[];
  artifacts: string[];
  decision: string;
  limitations: string[];
  nextStep: string;
};
type Registry = { schemaVersion: 1; id: string; version: string; title: string; entries: Entry[] };

async function main() {
  const input = path.resolve(readArg("--input", "docs/experiments/registry.v1.json"));
  const output = path.resolve(readArg("--output", "docs/experiments/THESIS_EXPERIMENT_MAP"));
  const registry = JSON.parse(await fs.readFile(input, "utf8")) as Registry;
  const errors = await validate(registry);
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(`${output}.md`, `${renderMarkdown(registry).trimEnd()}\n`);
  await fs.writeFile(`${output}.csv`, renderCsv(registry.entries));
  console.log(`VALID ${registry.id}@${registry.version}: ${registry.entries.length} experiment families.`);
  console.log(`Wrote ${output}.md and ${output}.csv`);
}

async function validate(registry: Registry) {
  const errors: string[] = [];
  if (registry.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const entry of registry.entries ?? []) {
    if (ids.has(entry.id)) errors.push(`Duplicate entry id '${entry.id}'.`);
    if (orders.has(entry.order)) errors.push(`Duplicate order '${entry.order}'.`);
    ids.add(entry.id);
    orders.add(entry.order);
    for (const field of ["thesisSection", "researchQuestion", "variable", "decision", "nextStep"] as const) {
      if (!entry[field]?.trim()) errors.push(`${entry.id}: ${field} is required.`);
    }
    if (!entry.controls?.length || !entry.metrics?.length || !entry.limitations?.length) errors.push(`${entry.id}: controls, metrics, and limitations are required.`);
    if (["completed", "superseded"].includes(entry.status) && !entry.artifacts.length) errors.push(`${entry.id}: finished entries require artifacts.`);
    for (const artifact of entry.artifacts) {
      try { await fs.access(path.resolve(artifact)); } catch { errors.push(`${entry.id}: missing artifact '${artifact}'.`); }
    }
  }
  return errors;
}

function renderMarkdown(registry: Registry) {
  const entries = [...registry.entries].sort((left, right) => left.order - right.order);
  return `# Thesis experiment map\n\n- Registry: \`${registry.id}@${registry.version}\`\n- Experiment families: **${entries.length}**\n- Completed: **${entries.filter((item) => item.status === "completed").length}**\n- Superseded but retained: **${entries.filter((item) => item.status === "superseded").length}**\n\nThis is the narrative index for the thesis. The JSON registry is the source of truth; generated Markdown and CSV provide readable and tabular views. Every experiment records its question, isolated variable, controls, metrics, decision, limitations, and next action.\n\n| Order | Thesis section | Experiment | Status | Variable | Decision |\n|---:|---|---|---|---|---|\n${entries.map((item) => `| ${item.order} | ${item.thesisSection} | ${item.id} | ${item.status} | ${item.variable} | ${item.decision} |`).join("\n")}\n\n${entries.map(renderEntry).join("\n")}\n`;
}

function renderEntry(entry: Entry) {
  return `## ${entry.order}. ${entry.thesisSection}: ${entry.id}\n\n- **Research question:** ${entry.researchQuestion}\n- **Status:** ${entry.status}\n- **Changed variable:** ${entry.variable}\n- **Controls:** ${entry.controls.join("; ")}\n- **Metrics:** ${entry.metrics.join("; ")}\n- **Artifacts:** ${entry.artifacts.length ? entry.artifacts.map((item) => `\`${item}\``).join("; ") : "not created yet"}\n- **Decision:** ${entry.decision}\n- **Limitations:** ${entry.limitations.join("; ")}\n- **Next step:** ${entry.nextStep}\n`;
}

function renderCsv(entries: Entry[]) {
  const rows = entries.sort((left, right) => left.order - right.order).map((item) => [item.order, item.id, item.thesisSection, item.status, item.researchQuestion, item.variable, item.controls.join("; "), item.metrics.join("; "), item.artifacts.join("; "), item.decision, item.limitations.join("; "), item.nextStep]);
  return [["order", "id", "thesis_section", "status", "research_question", "variable", "controls", "metrics", "artifacts", "decision", "limitations", "next_step"], ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n";
}

function csv(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function readArg(name: string, fallback: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }

main().catch((error) => { console.error(error); process.exit(1); });
