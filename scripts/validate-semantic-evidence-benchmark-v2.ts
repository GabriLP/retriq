import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type Seed = {
  questions: Array<{ id: string; technology: string; question: string; expectedFacts: string[] }>;
};
type Packet = {
  id: string;
  caseId: string;
  constructionCategory: "direct-complete" | "alternative-complete" | "related-incomplete" | "distractor-insufficient";
  intendedSufficient: boolean;
  evidence: Array<{ id: string; sourceId: string | null; score: number; rank: number }>;
};
type Benchmark = {
  id: string;
  status: string;
  sourceSeed: string;
  lockedTestTouched: boolean;
  reviewOrder: string[];
  states: Packet[];
};
type Protocol = {
  id: string;
  status: string;
  benchmark: { seedSha256: string; packetsSha256: string; states: number; uniqueQuestions: number; chunksPerPacket: number };
};
type Chunk = { id: string; language?: string; title: string; section: string; sourceUrl: string; content: string };

const benchmarkPath = path.resolve("docs/evaluation/semantic-evidence-benchmark.v2.json");
const seedPath = path.resolve("docs/evaluation/semantic-evidence-benchmark.v2.seed.json");
const chunksPath = path.resolve("data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec/chunks.json");

async function main() {
  const [benchmarkRaw, seedRaw, chunksRaw, splitRaw, v1Raw, protocolRaw] = await Promise.all([
    fs.readFile(benchmarkPath, "utf8"),
    fs.readFile(seedPath, "utf8"),
    fs.readFile(chunksPath, "utf8"),
    fs.readFile("docs/evaluation/golden-set-splits.v4.json", "utf8"),
    fs.readFile("docs/experiment-results/agentic-semantic-assessor-v1-validation.json", "utf8"),
    fs.readFile("docs/experiments/agentic-semantic-assessor.v2.json", "utf8"),
  ]);
  const benchmark = JSON.parse(benchmarkRaw) as Benchmark;
  const seed = JSON.parse(seedRaw) as Seed;
  const chunks = JSON.parse(chunksRaw) as Chunk[];
  const split = JSON.parse(splitRaw) as { test: string[] };
  const v1 = JSON.parse(v1Raw) as { observations: Array<{ stateId: string; caseId: string; retrieved: Array<{ id: string }> }> };
  const protocol = JSON.parse(protocolRaw) as Protocol;
  const errors: string[] = [];
  const questionIds = new Set(seed.questions.map((item) => item.id));
  const stateIds = new Set(benchmark.states.map((item) => item.id));
  const chunksById = new Map<string, Chunk[]>();
  for (const chunk of chunks) chunksById.set(chunk.id, [...(chunksById.get(chunk.id) ?? []), chunk]);

  if (benchmark.id !== "semantic-evidence-benchmark-v2") errors.push("Unexpected benchmark id.");
  if (protocol.id !== "agentic-semantic-assessor-v2" || !["awaiting-blinded-human-review", "human-reference-frozen", "completed"].includes(protocol.status)) errors.push("Protocol is not at a valid frozen benchmark stage.");
  if (protocol.benchmark.seedSha256 !== sha256(seedRaw) || protocol.benchmark.packetsSha256 !== sha256(benchmarkRaw)) errors.push("Protocol benchmark hashes do not match frozen artifacts.");
  if (protocol.benchmark.states !== 24 || protocol.benchmark.uniqueQuestions !== 12 || protocol.benchmark.chunksPerPacket !== 2) errors.push("Protocol sample controls do not match the validator.");
  if (benchmark.lockedTestTouched) errors.push("Locked test must remain untouched.");
  if (path.resolve(benchmark.sourceSeed) !== seedPath) errors.push("Benchmark source seed mismatch.");
  if (seed.questions.length !== 12 || questionIds.size !== 12) errors.push("Expected 12 unique seed questions.");
  if (benchmark.states.length !== 24 || stateIds.size !== 24) errors.push("Expected 24 unique evidence states.");
  if (benchmark.reviewOrder.length !== 24 || new Set(benchmark.reviewOrder).size !== 24 || benchmark.reviewOrder.some((id) => !stateIds.has(id))) errors.push("Review order must be a permutation of all 24 states.");
  if (benchmark.states.filter((item) => item.intendedSufficient).length !== 12) errors.push("Expected 12 intended-sufficient packets.");
  if (benchmark.states.filter((item) => !item.intendedSufficient).length !== 12) errors.push("Expected 12 intended-insufficient packets.");

  const v1StateIds = new Set(v1.observations.map((item) => item.stateId));
  const v1CaseIds = new Set(v1.observations.map((item) => item.caseId));
  const testIds = new Set(split.test);
  for (const question of seed.questions) {
    const packets = benchmark.states.filter((item) => item.caseId === question.id);
    if (packets.length !== 2 || packets.filter((item) => item.intendedSufficient).length !== 1) errors.push(`${question.id}: expected one sufficient and one insufficient packet.`);
    if (question.expectedFacts.length < 3) errors.push(`${question.id}: expected at least three explicit facts.`);
    if (v1CaseIds.has(question.id) || testIds.has(question.id)) errors.push(`${question.id}: overlaps prior v1 or locked test cases.`);
  }
  for (const state of benchmark.states) {
    if (!questionIds.has(state.caseId)) errors.push(`${state.id}: unknown seed question.`);
    if (v1StateIds.has(state.id)) errors.push(`${state.id}: overlaps a v1 state id.`);
    if (state.evidence.length !== 2) errors.push(`${state.id}: expected exactly two excerpts.`);
    if (new Set(state.evidence.map((item) => item.id)).size !== state.evidence.length) errors.push(`${state.id}: duplicate excerpt id.`);
    state.evidence.forEach((item, index) => {
      if (item.rank !== index + 1) errors.push(`${state.id}: ranks must be consecutive and ordered.`);
      if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1) errors.push(`${state.id}: invalid score.`);
      if (index && item.score > state.evidence[index - 1].score) errors.push(`${state.id}: evidence scores must be descending.`);
      const candidates = chunksById.get(item.id) ?? [];
      if (candidates.length !== 1) errors.push(`${state.id}: chunk ${item.id} resolves to ${candidates.length} corpus entries.`);
    });
  }
  const packetSignatures = new Set(benchmark.states.map((item) => signature(item.caseId, item.evidence.map((chunk) => chunk.id))));
  const v1Signatures = new Set(v1.observations.map((item) => signature(item.caseId, item.retrieved.map((chunk) => chunk.id))));
  for (const value of packetSignatures) if (v1Signatures.has(value)) errors.push(`Packet overlaps v1: ${value}`);
  if (errors.length) throw new Error(errors.join("\n"));

  const categories = Object.fromEntries([...new Set(benchmark.states.map((item) => item.constructionCategory))].sort().map((category) => [category, benchmark.states.filter((item) => item.constructionCategory === category).length]));
  console.log(`VALID ${benchmark.id}: 24 packets, 12 questions, 12/12 intended balance.`);
  console.log(`Categories: ${Object.entries(categories).map(([key, value]) => `${key}=${value}`).join(", ")}.`);
  console.log(`Locked test overlap: 0; v1 state overlap: 0; missing or ambiguous chunks: 0.`);
  console.log(`Benchmark SHA-256: ${sha256(benchmarkRaw)}`);
}

function signature(caseId: string, ids: string[]) { return `${caseId}::${[...ids].sort().join("|")}`; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
