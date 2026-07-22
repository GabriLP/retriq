# Final locked retrieval test

- Protocol: `baseline-final-test-v1`
- Executed: 2026-07-22T11:12:52.389Z
- Commit: `7ad83fbd96bc205142b041347a8831c85eb564ee`
- Split: **test (single execution)**
- Approval provenance: **pending-confirmation; not independently human-approved**
- Configuration: 300-word chunks, 80-word overlap, Gemini Embedding 2 (1,024 dimensions), metadata-aware dense cosine, threshold 0.68, top-k 4, no reranker, no agentic loop

| Metric | Result | Frozen check |
|---|---:|---:|
| Recall@4 | 1.0000 | >= 0.9167 |
| Precision@4 | 0.6667 | descriptive |
| MRR | 0.9375 | >= 0.8500 |
| nDCG@4 | 0.9526 | >= 0.8500 |
| Unanswerable FPR | 0.0833 | <= 0.0833 |

All frozen checks: **PASS**. Estimated embedding cost: **$0.000145**; provider requests: **1**.

## Binomial uncertainty (Wilson 95%)

| Proportion | Count | Rate | 95% interval |
|---|---:|---:|---:|
| Full canonical coverage | 12/12 | 1.0000 | [0.7575, 1.0000] |
| Any canonical hit | 12/12 | 1.0000 | [0.7575, 1.0000] |
| False positives | 1/12 | 0.0833 | [0.0149, 0.3539] |

This result is retained regardless of outcome and was not used for tuning. It verifies retrieval only. With only 12 cases per class and provisional AI-assisted benchmark approvals, the intervals and provenance limitation must accompany thesis claims.
