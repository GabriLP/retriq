CREATE EXTENSION IF NOT EXISTS vector;

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS rag_corpus_versions (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('loading', 'ready', 'failed')),
  source_run_id text NOT NULL,
  source_run_path text NOT NULL,
  chunks_sha256 text NOT NULL,
  config_sha256 text NOT NULL,
  embedding_provider text NOT NULL,
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL CHECK (embedding_dimensions = 1024),
  chunk_count integer NOT NULL CHECK (chunk_count >= 0),
  source_count integer NOT NULL CHECK (source_count >= 0),
  word_count bigint NOT NULL CHECK (word_count >= 0),
  configuration jsonb NOT NULL,
  UNIQUE (chunks_sha256, config_sha256)
);

-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS rag_corpus_versions_one_active_idx
  ON rag_corpus_versions (is_active)
  WHERE is_active;

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS rag_chunks (
  corpus_version_id text NOT NULL REFERENCES rag_corpus_versions(id) ON DELETE CASCADE,
  chunk_id text NOT NULL,
  title text NOT NULL,
  section text NOT NULL,
  content text NOT NULL,
  source_url text NOT NULL,
  source_id text,
  source_type text CHECK (source_type IS NULL OR source_type IN ('html', 'markdown', 'pdf')),
  language text,
  version text,
  family text,
  document_role text,
  authority text,
  stability text,
  publisher text,
  page_start integer,
  page_end integer,
  word_count integer NOT NULL CHECK (word_count >= 0),
  embedding vector(1024) NOT NULL,
  PRIMARY KEY (corpus_version_id, chunk_id)
);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS rag_chunks_corpus_source_idx
  ON rag_chunks (corpus_version_id, source_url);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS rag_chunks_corpus_language_version_idx
  ON rag_chunks (corpus_version_id, language, version);

-- Exact cosine search is intentional for the first production baseline.
-- HNSW or IVFFlat must be introduced only as separately measured experiments.
