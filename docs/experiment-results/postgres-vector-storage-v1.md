# PostgreSQL pgvector production storage v1

- Provider/plan: **Neon Free**, Frankfurt (`aws-eu-central-1`)
- Search: **exact cosine**, no HNSW or IVFFlat
- Active corpus: **434 sources, 33,079 chunks, 6,117,327 words**
- Embeddings: **Gemini Embedding 2, 1,024 dimensions**
- Database size after import: **228 MB**
- Observed database cost: **$0**
- Locked test split touched: **no**

## Equivalence result

The PostgreSQL implementation reproduced the frozen rankings and cosine scores for all **54/54 validation cases** within a 0.0002 score tolerance. Import and verification reused the content-addressed embedding cache and made **zero provider requests**.

The historical run contains 561 rows whose old 16-character chunk ID is repeated. Every row is retained under its frozen ordinal; public chunk IDs remain unchanged so existing benchmark references stay valid.

## Decision

Use pgvector exact cosine search for the first expanded production corpus. Approximate HNSW and IVFFlat indexes remain disabled: adding either can change ranking and recall, so each must be preregistered and evaluated separately before adoption.

The Java SE 26 end-to-end smoke test retrieved four chunks from the official JLS PDF with a top score of 0.797 and 985 ms retrieval time. This is connectivity evidence only, not a latency benchmark.
