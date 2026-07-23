# Final locked retrieval test

- Protocol: `confirmatory-final-test-v2`
- Executed: 2026-07-23T18:20:42.256Z
- Commit: `519b5f2007b0cf3ad15a1f853f5ef53118b99733`
- Split: **test (single execution)**
- Approval provenance: **confirmed; thesis-author confirmed**
- Configuration: 300-word chunks, 80-word overlap, Gemini Embedding 2 (1,024 dimensions), metadata-aware dense cosine, threshold 0.68, top-k 4, no reranker, no agentic loop

| Metric | Result | Frozen check |
|---|---:|---:|
| Recall@4 | 0.8750 | >= 0.9167 |
| Precision@4 | 0.5243 | descriptive |
| MRR | 0.7257 | >= 0.8500 |
| nDCG@4 | 0.7635 | >= 0.8500 |
| Unanswerable FPR | 0.0417 | <= 0.0833 |

All frozen checks: **FAIL**. Estimated embedding cost: **$0.000263**; provider requests: **2**.

## Binomial uncertainty (Wilson 95%)

| Proportion | Count | Rate | 95% interval |
|---|---:|---:|---:|
| Full canonical coverage | 21/24 | 0.8750 | [0.6900, 0.9566] |
| Any canonical hit | 21/24 | 0.8750 | [0.6900, 0.9566] |
| False positives | 1/24 | 0.0417 | [0.0074, 0.2024] |

This result is retained regardless of outcome and was not used for tuning. It verifies retrieval only. The uncertainty intervals and single-reviewer provenance must accompany thesis claims.
