# Retrieval comparison

Generated: 2026-07-16T08:22:16.179Z

> **Preliminary:** only source-verified seed cases are included. Final thesis tables require a larger human-approved set. 1 invalidated attempt(s) were retained locally and excluded here.

| Experiment | Chunks | Embedding | k | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Cache hits | API inputs | Provider requests | Est. API tokens | Est. cost USD | Embedding ms |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| common-programming-word-300 | 30455 | gemini-embedding-2 | 4 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 1.0000 | 20392 | 9626 | 301 | 5262853 | 1.052571 | 274452 |
| common-programming-word-450 | 27496 | gemini-embedding-2 | 4 | 1.0000 | 0.6875 | 1.0000 | 0.9933 | 1.0000 | 22073 | 4988 | 156 | 3821759 | 0.764352 | 202039 |
| common-programming-word-850 | 25553 | gemini-embedding-2 | 4 | 1.0000 | 0.5208 | 1.0000 | 1.0000 | 1.0000 | 0 | 25119 | 786 | 8036225 | 1.607245 | 535697 |

## Interpretation guardrails

- Cache state may change embedding latency and cost, but it must not change vectors or retrieval quality.
- Cost values are estimates and remain unavailable when no explicit provider price assumption was recorded.
- No chunking or model choice is accepted until the benchmark has sufficient human-approved language coverage.
