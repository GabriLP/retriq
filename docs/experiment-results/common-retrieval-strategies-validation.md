# Retrieval strategy comparison

- Protocol/attempt: `common-retrieval-strategies-v1` / `20260716124918835`
- Parent run: `20260716104232129-aad7c6f9`
- Split: **validation** (6 answerable + 6 unanswerable)
- Hypothesis: BM25 will improve exact technical-term matching, while hybrid RRF will preserve semantic recall and reduce the weaknesses of either retriever alone.
- Cache-only: **yes**

## Calibrated comparison

| Strategy | Selected threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR | Query scoring ms | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dense-cosine | 0.75 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 0.0000 | 288 | Selected by the predeclared validation rule. |
| bm25 | n/a | n/a | n/a | n/a | n/a | n/a | 306 | No candidate satisfied zero false positives and both quality guardrails. |
| hybrid-rrf | n/a | n/a | n/a | n/a | n/a | n/a | 1 | No candidate satisfied zero false positives and both quality guardrails. |

BM25 index construction took 671 ms and is reported separately from query scoring. Dense embedding generation is excluded because vectors were loaded from the shared cache.

## Ranking-only diagnostic

| Strategy | Recall@4 | Precision@4 | MRR | nDCG@4 |
|---|---:|---:|---:|---:|
| dense-cosine | 1.0000 | 0.6667 | 1.0000 | 1.0000 |
| bm25 | 0.5833 | 0.2917 | 0.4583 | 0.4696 |
| hybrid-rrf | 0.5833 | 0.3750 | 0.5556 | 0.5189 |

### Answerable cases missed at ranking stage

- dense-cosine: none
- bm25: `react-effects-001`, `java-spec-release-001`, `java-ods-arraystack-amortized-001`
- hybrid-rrf: `react-effects-001`, `c-standard-purpose-001`, `java-spec-release-001`

Ranking-only metrics ignore abstention and expose ordering quality. Calibrated metrics apply a strategy-specific validation threshold; raw score thresholds are not comparable across cosine, BM25, and RRF. No held-out test cases are used for strategy selection.

## Controlled variables

- corpus snapshot
- golden-set validation cases
- 300-word chunks with 80-word overlap
- topK=4
- Gemini embedding model and dimensionality for strategies that use vectors
