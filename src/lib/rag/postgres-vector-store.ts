import { ragConfig } from "./config";
import { getDatabaseSql } from "./database";
import type { QueryMetadataConstraint } from "./metadata-filter";
import type { CorpusSummary, RetrievalResult } from "./types";

type SummaryRow = {
  source_count: string | number;
  chunk_count: string | number;
  word_count: string | number;
  indexed_at: string | Date;
};

type RetrievalRow = {
  row_ordinal?: number;
  chunk_id: string;
  title: string;
  section: string;
  content: string;
  source_url: string;
  source_id: string | null;
  source_type: "html" | "markdown" | "pdf" | null;
  language: string | null;
  version: string | null;
  family: string | null;
  document_role: string | null;
  authority: string | null;
  stability: string | null;
  publisher: string | null;
  page_start: number | null;
  page_end: number | null;
  word_count: number;
  score: string | number;
};

export async function readPostgresCorpusSummary(): Promise<CorpusSummary> {
  const rows = await getDatabaseSql().query(
    `SELECT
       COUNT(DISTINCT c.source_url)::bigint AS source_count,
       COUNT(*)::bigint AS chunk_count,
       COALESCE(SUM(c.word_count), 0)::bigint AS word_count,
       v.activated_at AS indexed_at
     FROM rag_corpus_versions v
     JOIN rag_chunks c ON c.corpus_version_id = v.id
     WHERE v.is_active = true AND v.status = 'ready'
     GROUP BY v.id, v.activated_at`,
    [],
  ) as unknown as SummaryRow[];
  const row = rows[0];
  if (!row) throw new Error("No active ready corpus exists in PostgreSQL.");
  return {
    sourceCount: Number(row.source_count),
    chunkCount: Number(row.chunk_count),
    wordCount: Number(row.word_count),
    indexedAt: new Date(row.indexed_at).toISOString(),
  };
}

export async function searchPostgresChunks(queryEmbedding: number[], topK: number, constraint: QueryMetadataConstraint | null): Promise<RetrievalResult[]> {
  const vector = toPgVector(queryEmbedding, ragConfig.embeddingOutputDimensionality);
  const limit = normalizedTopK(topK);
  const rows = await getDatabaseSql().query(
    `WITH ranked AS (
       SELECT
         c.row_ordinal, c.chunk_id, c.title, c.section, c.content, c.source_url, c.source_id,
         c.source_type, c.language, c.version, c.family, c.document_role,
         c.authority, c.stability, c.publisher, c.page_start, c.page_end,
         c.word_count, 1 - (c.embedding <=> $1::vector) AS score
       FROM rag_chunks c
       JOIN rag_corpus_versions v ON v.id = c.corpus_version_id
       WHERE v.is_active = true AND v.status = 'ready'
         AND ($4::text[] IS NULL OR c.language = ANY($4::text[]))
         AND ($5::text IS NULL OR c.version ILIKE '%' || $5 || '%')
     ), eligible AS (
       SELECT ranked.*,
         ROW_NUMBER() OVER (PARTITION BY language ORDER BY score DESC, row_ordinal ASC) AS language_rank
       FROM ranked
       WHERE score >= $2
     )
     SELECT * FROM eligible
     ORDER BY
       CASE WHEN $6::boolean THEN language_rank ELSE 1 END ASC,
       score DESC,
       row_ordinal ASC
     LIMIT $3`,
    [
      vector,
      ragConfig.minScore,
      limit,
      constraint?.databaseLanguages ?? null,
      constraint?.requestedVersion === null || constraint?.requestedVersion === undefined ? null : String(constraint.requestedVersion),
      (constraint?.databaseLanguages.length ?? 0) > 1,
    ],
  ) as unknown as RetrievalRow[];
  return rows.map((row, index) => mapRetrievalRow(row, index + 1));
}

export function toPgVector(values: number[], expectedDimensions: number) {
  if (values.length !== expectedDimensions) {
    throw new Error(`Expected a ${expectedDimensions}-dimension query embedding, received ${values.length}.`);
  }
  if (!values.every(Number.isFinite)) throw new Error("Query embedding contains a non-finite value.");
  return `[${values.join(",")}]`;
}

export function mapRetrievalRow(row: RetrievalRow, rank: number): RetrievalResult {
  return compact({
    id: row.chunk_id,
    title: row.title,
    section: row.section,
    content: row.content,
    sourceUrl: row.source_url,
    sourceId: row.source_id ?? undefined,
    sourceType: row.source_type ?? undefined,
    language: row.language ?? undefined,
    version: row.version ?? undefined,
    family: row.family ?? undefined,
    documentRole: row.document_role ?? undefined,
    authority: row.authority ?? undefined,
    stability: row.stability ?? undefined,
    publisher: row.publisher ?? undefined,
    pageStart: row.page_start ?? undefined,
    pageEnd: row.page_end ?? undefined,
    wordCount: Number(row.word_count),
    rank,
    score: Number(Number(row.score).toFixed(4)),
  });
}

function normalizedTopK(topK: number) {
  if (!Number.isFinite(topK)) return ragConfig.defaultTopK;
  return Math.max(1, Math.min(50, Math.trunc(topK)));
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
