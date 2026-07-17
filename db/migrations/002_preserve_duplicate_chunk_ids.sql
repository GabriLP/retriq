ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS row_ordinal integer;

-- statement-breakpoint
WITH numbered AS (
  SELECT corpus_version_id, chunk_id,
         ROW_NUMBER() OVER (PARTITION BY corpus_version_id ORDER BY chunk_id) - 1 AS ordinal
  FROM rag_chunks
)
UPDATE rag_chunks c
SET row_ordinal = numbered.ordinal
FROM numbered
WHERE c.corpus_version_id = numbered.corpus_version_id
  AND c.chunk_id = numbered.chunk_id
  AND c.row_ordinal IS NULL;

-- statement-breakpoint
ALTER TABLE rag_chunks ALTER COLUMN row_ordinal SET NOT NULL;

-- statement-breakpoint
ALTER TABLE rag_chunks DROP CONSTRAINT IF EXISTS rag_chunks_pkey;

-- statement-breakpoint
ALTER TABLE rag_chunks ADD CONSTRAINT rag_chunks_pkey PRIMARY KEY (corpus_version_id, row_ordinal);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS rag_chunks_corpus_chunk_id_idx
  ON rag_chunks (corpus_version_id, chunk_id);

-- Frozen experiment artifacts contain repeated 16-character chunk IDs because
-- the historical ID used only a prefix of the content. row_ordinal preserves
-- every frozen row without rewriting IDs referenced by benchmark artifacts.
