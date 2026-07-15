import assert from "node:assert/strict";

import { diffExperimentConfigs, findUncontrolledExperimentPaths } from "../src/lib/rag/benchmark-suite";
import type { ExperimentConfig } from "../src/lib/rag/experiment-types";

const baseline = createConfig();
const targetVariant = createConfig({ id: "target-450", targetWords: 450 });
const uncontrolledVariant = createConfig({ id: "different-model", embeddingModel: "other-model" });

assert.deepEqual(diffExperimentConfigs(baseline, targetVariant), ["chunking.targetWords"]);
assert.deepEqual(diffExperimentConfigs(baseline, uncontrolledVariant), ["embedding.model"]);
assert.deepEqual(diffExperimentConfigs(baseline, { ...baseline, title: "Metadata-only title" }), []);
assert.deepEqual(findUncontrolledExperimentPaths(baseline, targetVariant, ["chunking.targetWords"]), []);
assert.deepEqual(findUncontrolledExperimentPaths(baseline, uncontrolledVariant, ["chunking.targetWords"]), [
  "embedding.model",
]);

console.log("Benchmark suite comparison tests passed.");

function createConfig(
  overrides: { id?: string; targetWords?: number; embeddingModel?: string } = {},
): ExperimentConfig {
  return {
    schemaVersion: 1,
    id: overrides.id ?? "target-850",
    title: "Controlled chunk-size experiment",
    hypothesis: "Changing only targetWords changes retrieval ranking quality.",
    corpus: { manifests: ["docs/corpus/react-learn.json", "docs/corpus/programming-foundation.json"] },
    chunking: {
      strategy: "word-window",
      minWords: 200,
      targetWords: overrides.targetWords ?? 850,
      overlapWords: 80,
    },
    embedding: { provider: "google", model: overrides.embeddingModel ?? "gemini-embedding-2" },
    retrieval: { strategy: "dense-cosine", topK: 4, minScore: 0.18 },
    generation: { provider: "google", model: "gemini-3.5-flash" },
    evaluation: {
      judgeEnabled: false,
      judgeModel: "gemini-3.5-flash",
      goldenSet: "docs/evaluation/golden-set.v1.json",
      caseStatuses: ["source-verified"],
    },
  };
}
