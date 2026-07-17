import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

import type { DocumentationChunk } from "../src/lib/rag/types";

type RunArtifact = {
  runId: string;
  experimentId: string;
  statistics: { sourceCount: number; chunkCount: number; wordCount: number };
};

type ExperimentConfig = {
  embedding: { provider: "google"; model: string; outputDimensionality: number; documentTask: "RETRIEVAL_DOCUMENT"; batchSize: number };
};

const columnNames = [
  "corpus_version_id", "row_ordinal", "chunk_id", "title", "section", "content", "source_url", "source_id",
  "source_type", "language", "version", "family", "document_role", "authority", "stability",
  "publisher", "page_start", "page_end", "word_count", "embedding",
];

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const runDirectory = path.resolve(readArg("--run", "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec"));
  const batchSize = positiveInteger(readArg("--batch-size", "25"), 25, 100);
  const activate = process.argv.includes("--activate");
  const [chunksRaw, runRaw, configRaw] = await Promise.all([
    fs.readFile(path.join(runDirectory, "chunks.json"), "utf8"),
    fs.readFile(path.join(runDirectory, "run.json"), "utf8"),
    fs.readFile(path.join(runDirectory, "config.snapshot.json"), "utf8"),
  ]);
  const chunks = JSON.parse(chunksRaw) as DocumentationChunk[];
  const run = JSON.parse(runRaw) as RunArtifact;
  const configuration = JSON.parse(configRaw) as ExperimentConfig;
  validateFrozenInput(chunks, run, configuration);

  const versionId = `${run.experimentId}-${run.runId}`;
  const chunksSha256 = sha256(chunksRaw);
  const configSha256 = sha256(configRaw);
  const [{ getDatabaseSql }, { embedTextsWithCache }] = await Promise.all([
    import("../src/lib/rag/database"),
    import("../src/lib/rag/embeddings"),
  ]);
  const sql = getDatabaseSql();
  await sql.query(
    `INSERT INTO rag_corpus_versions (
       id, status, source_run_id, source_run_path, chunks_sha256, config_sha256,
       embedding_provider, embedding_model, embedding_dimensions, chunk_count,
       source_count, word_count, configuration
     ) VALUES ($1, 'loading', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       status = CASE WHEN rag_corpus_versions.status = 'ready' THEN 'ready' ELSE 'loading' END,
       source_run_path = EXCLUDED.source_run_path,
       chunks_sha256 = EXCLUDED.chunks_sha256, config_sha256 = EXCLUDED.config_sha256,
       chunk_count = EXCLUDED.chunk_count, source_count = EXCLUDED.source_count,
       word_count = EXCLUDED.word_count, configuration = EXCLUDED.configuration`,
    [versionId, run.runId, relative(runDirectory), chunksSha256, configSha256,
      configuration.embedding.provider, configuration.embedding.model, configuration.embedding.outputDimensionality,
      chunks.length, run.statistics.sourceCount, run.statistics.wordCount, configRaw],
  );

  const existingRows = await sql.query("SELECT row_ordinal FROM rag_chunks WHERE corpus_version_id = $1", [versionId]) as unknown as Array<{ row_ordinal: number }>;
  const storedOrdinals = new Set(existingRows.map((row) => Number(row.row_ordinal)));
  let imported = storedOrdinals.size;
  if (imported) console.log(`Resuming with ${imported}/${chunks.length} chunks already stored.`);
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const entries = chunks.slice(offset, offset + batchSize)
      .map((chunk, index) => ({ chunk, ordinal: offset + index }))
      .filter((entry) => !storedOrdinals.has(entry.ordinal));
    if (!entries.length) continue;
    const embeddingResult = await embedTextsWithCache(entries.map(({ chunk }) => `${chunk.section}\n${chunk.content}`), {
      provider: configuration.embedding.provider,
      model: configuration.embedding.model,
      taskType: configuration.embedding.documentTask,
      outputDimensionality: configuration.embedding.outputDimensionality,
      titles: entries.map(({ chunk }) => chunk.title),
      batchSize: configuration.embedding.batchSize,
      cache: true,
      allowProviderRequests: false,
    });
    const { query, parameters } = insertBatch(versionId, entries, embeddingResult.vectors);
    await sql.query(query, parameters);
    imported += entries.length;
    if (imported === chunks.length || imported % 500 === 0) console.log(`Imported ${imported}/${chunks.length} chunks.`);
  }

  const counts = await sql.query(
    `SELECT COUNT(*)::bigint AS chunk_count, COUNT(DISTINCT source_url)::bigint AS source_count,
            COALESCE(SUM(word_count), 0)::bigint AS word_count
     FROM rag_chunks WHERE corpus_version_id = $1`,
    [versionId],
  ) as unknown as Array<{ chunk_count: string; source_count: string; word_count: string }>;
  const actual = counts[0];
  if (!actual || Number(actual.chunk_count) !== chunks.length || Number(actual.source_count) !== run.statistics.sourceCount || Number(actual.word_count) !== run.statistics.wordCount) {
    await sql.query("UPDATE rag_corpus_versions SET status = 'failed' WHERE id = $1", [versionId]);
    throw new Error(`Imported corpus statistics do not match the frozen run: ${JSON.stringify(actual)}.`);
  }
  await sql.query("UPDATE rag_corpus_versions SET status = 'ready' WHERE id = $1", [versionId]);
  if (activate) {
    await sql.query(
      `WITH deactivated AS (
         UPDATE rag_corpus_versions SET is_active = false WHERE is_active = true RETURNING id
       )
       UPDATE rag_corpus_versions SET is_active = true, activated_at = now()
       WHERE id = $1 AND status = 'ready'`,
      [versionId],
    );
  }
  console.log(`Corpus ${versionId} is ready${activate ? " and active" : ""}.`);
  console.log(`Hashes: chunks=${chunksSha256}, config=${configSha256}.`);
}

function insertBatch(versionId: string, entries: Array<{ chunk: DocumentationChunk; ordinal: number }>, embeddings: number[][]) {
  const parameters: unknown[] = [];
  const rows = entries.map(({ chunk, ordinal }, index) => {
    const values = [
      versionId, ordinal, chunk.id, chunk.title, chunk.section, chunk.content, chunk.sourceUrl, chunk.sourceId ?? null,
      chunk.sourceType ?? null, chunk.language ?? null, chunk.version ?? null, chunk.family ?? null,
      chunk.documentRole ?? null, chunk.authority ?? null, chunk.stability ?? null, chunk.publisher ?? null,
      chunk.pageStart ?? null, chunk.pageEnd ?? null, chunk.wordCount, `[${embeddings[index].join(",")}]`,
    ];
    const placeholders = values.map((value, valueIndex) => {
      parameters.push(value);
      const position = parameters.length;
      return valueIndex === values.length - 1 ? `$${position}::vector` : `$${position}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return {
    query: `INSERT INTO rag_chunks (${columnNames.join(", ")}) VALUES ${rows.join(", ")}
      ON CONFLICT (corpus_version_id, row_ordinal) DO UPDATE SET
        chunk_id = EXCLUDED.chunk_id,
        title = EXCLUDED.title, section = EXCLUDED.section, content = EXCLUDED.content,
        source_url = EXCLUDED.source_url, source_id = EXCLUDED.source_id, source_type = EXCLUDED.source_type,
        language = EXCLUDED.language, version = EXCLUDED.version, family = EXCLUDED.family,
        document_role = EXCLUDED.document_role, authority = EXCLUDED.authority,
        stability = EXCLUDED.stability, publisher = EXCLUDED.publisher,
        page_start = EXCLUDED.page_start, page_end = EXCLUDED.page_end,
        word_count = EXCLUDED.word_count, embedding = EXCLUDED.embedding`,
    parameters,
  };
}

function validateFrozenInput(chunks: DocumentationChunk[], run: RunArtifact, config: ExperimentConfig) {
  if (config.embedding.provider !== "google" || config.embedding.model !== "gemini-embedding-2" || config.embedding.outputDimensionality !== 1024) {
    throw new Error("The first PostgreSQL production corpus is frozen to google/gemini-embedding-2 at 1024 dimensions.");
  }
  if (chunks.length !== run.statistics.chunkCount) {
    throw new Error("Frozen run chunk count is inconsistent.");
  }
  const duplicateRows = chunks.length - new Set(chunks.map((chunk) => chunk.id)).size;
  if (duplicateRows) console.warn(`Preserving ${duplicateRows} rows with repeated historical chunk IDs by frozen row ordinal.`);
}

function readArg(name: string, fallback: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
function positiveInteger(value: string, fallback: number, maximum: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function relative(value: string) { return path.relative(process.cwd(), value).replaceAll("\\", "/"); }

main().catch((error) => { console.error(error); process.exit(1); });
