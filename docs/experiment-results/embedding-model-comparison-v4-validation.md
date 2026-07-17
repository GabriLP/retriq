# Embedding model comparison — benchmark v4 validation

Generated from frozen run artifacts: 2026-07-17T09:09:33.845Z

## Outcome

Gemini Embedding 2 remains the selected embedding model because it is the only candidate satisfying every pre-registered guardrail. The comparison changes only the embedding provider/model; all models use 1024 dimensions, 300-word chunks with 80-word overlap, metadata-aware dense cosine retrieval, topK 4, and the same 54 validation cases.

| Model | Selected threshold | Best zero-FPR threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | FPR | Clean-run est. USD | Retry overhead USD | Eligible |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Gemini Embedding 2 | 0.68 | 0.68 | 0.9630 | 0.6296 | 0.9444 | 0.9493 | 0.0000 | 0.271224 | 0.000000 | yes |
| OpenAI text-embedding-3-small | none | 0.6 | 0.6296 | 0.4321 | 0.5926 | 0.6023 | 0.0000 | 0.026402 | 0.000000 | no |
| OpenAI text-embedding-3-large | none | 0.6 | 0.8333 | 0.6883 | 0.7901 | 0.7917 | 0.0000 | 0.171610 | 0.000000 | no |
| Voyage Code 3 | none | 0.5 | 0.9444 | 0.5185 | 0.8210 | 0.8433 | 0.0000 | 0.237614 | 0.009315 | no |

For the selected model, the table reports the selected-threshold metrics. For rejected models, it reports their best nDCG result among thresholds with zero false positives.

## Rejected alternatives

- **OpenAI text-embedding-3-small:** Recall@4 0.6296 < 0.9000; MRR 0.5926 < 0.8500
- **OpenAI text-embedding-3-large:** Recall@4 0.8333 < 0.9000; MRR 0.7901 < 0.8500
- **Voyage Code 3:** MRR 0.8210 < 0.8500

OpenAI Large was the strongest alternative at the permissive 0.18 threshold (Recall@4 0.9630, MRR 0.9012, nDCG@4 0.9141), but its no-answer FPR was 0.5556. At zero FPR, its best metadata-aware result fell to Recall@4 0.8333 and MRR 0.7901. Voyage retained Recall@4 0.9444 at zero FPR, but its MRR remained 0.8210, below the pre-registered 0.85 floor.

## Cost and execution notes

- Costs are incremental clean-run estimates based on cache misses and the provider prices observed on the recorded dates.
- Across all four indexed models, the clean-run estimate is USD 0.706850; including retry overhead, the observed estimate is USD 0.716165.
- The Voyage indexing process continued after the shell timed out. A concurrent resume caused 120 redundant API inputs, adding an estimated USD 0.009315 operational overhead. This is excluded from the clean-run model comparison and disclosed separately.
- Latency is not used for ranking because cache state, timeouts, and provider limits were not controlled equally.
- Benchmark approvals are provisional. The 24-case test split was untouched: **yes**.

## Decision

Retain Gemini Embedding 2 with metadata-aware retrieval and threshold 0.68 as the v4 validation baseline. Do not alter the guardrails after observing these results. The next experiment may use this frozen retriever while changing only the reranking or answer-generation component.
