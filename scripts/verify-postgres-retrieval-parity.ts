import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

type Benchmark = {
  frozenRetrieval: { embeddingModel: string; embeddingDimensions: number; denseEligibilityThreshold: number; topK: number; metadataAware: boolean };
  cases: Array<{ caseId: string; question: string; evidence: Array<{ chunkId: string; cosineScore: number }> }>;
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  process.env.RETRIQ_VECTOR_STORE_BACKEND = "postgres";
  process.env.GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY = "1024";
  process.env.RETRIQ_MIN_SCORE = "0.68";
  const benchmark = JSON.parse(await fs.readFile(path.resolve("docs/evaluation/generation-benchmark.v1.json"), "utf8")) as Benchmark;
  if (!benchmark.frozenRetrieval.metadataAware || benchmark.frozenRetrieval.embeddingDimensions !== 1024 || benchmark.frozenRetrieval.denseEligibilityThreshold !== 0.68) {
    throw new Error("The parity benchmark no longer matches the selected PostgreSQL production retrieval configuration.");
  }
  const [{ embedTextsWithCache }, { detectQueryMetadataConstraint }, { searchPostgresChunks }] = await Promise.all([
    import("../src/lib/rag/embeddings"), import("../src/lib/rag/metadata-filter"), import("../src/lib/rag/postgres-vector-store"),
  ]);
  const embeddings = await embedTextsWithCache(benchmark.cases.map((item) => item.question), {
    provider: "google", model: benchmark.frozenRetrieval.embeddingModel, taskType: "QUESTION_ANSWERING",
    outputDimensionality: benchmark.frozenRetrieval.embeddingDimensions, cache: true, allowProviderRequests: false,
  });
  const mismatches: string[] = [];
  for (let index = 0; index < benchmark.cases.length; index += 1) {
    const item = benchmark.cases[index];
    const actual = await searchPostgresChunks(embeddings.vectors[index], benchmark.frozenRetrieval.topK, detectQueryMetadataConstraint(item.question));
    const actualIds = actual.map((chunk) => chunk.id);
    const expectedIds = item.evidence.map((chunk) => chunk.chunkId);
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
      mismatches.push(`${item.caseId}: expected [${expectedIds}], received [${actualIds}].`);
      continue;
    }
    actual.forEach((chunk, rank) => {
      if (Math.abs(chunk.score - item.evidence[rank].cosineScore) > 0.0002) {
        mismatches.push(`${item.caseId}/${rank + 1}: expected score ${item.evidence[rank].cosineScore}, received ${chunk.score}.`);
      }
    });
  }
  if (mismatches.length) throw new Error(`PostgreSQL parity failed for ${mismatches.length} comparison(s):\n${mismatches.join("\n")}`);
  console.log(`PostgreSQL exact retrieval matches all ${benchmark.cases.length} frozen validation cases; provider requests: ${embeddings.apiRequests}.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
