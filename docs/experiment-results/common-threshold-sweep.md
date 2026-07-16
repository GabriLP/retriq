# Threshold sweep 20260716090040201

- Status: **completed**
- Base experiment/run: `common-programming-word-300` / `20260716080108101-0146f580`
- Readiness: **exploratory** - The dataset contains only one source-verified unanswerable case and has no held-out calibration/test split.
- Selected exploratory threshold: **0.65**
- Selection: Lowest-ranked candidate after requiring zero no-answer false positives and applying the declared guardrails and tie-breakers.
- Cache-only: yes

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 1.0000 | 52 |
| 0.40 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 1.0000 | 52 |
| 0.50 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 1.0000 | 52 |
| 0.55 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 1.0000 | 52 |
| 0.60 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 1.0000 | 49 |
| 0.65 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 0.0000 | 48 |
| 0.70 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 0.0000 | 48 |
| 0.75 | 1.0000 | 0.7847 | 1.0000 | 1.0000 | 0.0000 | 40 |
| 0.80 | 0.5000 | 0.4306 | 0.5000 | 0.5000 | 0.0000 | 10 |

Score diagnostics: maximum unanswerable top score 0.6084, minimum answerable top score 0.7653, and minimum answerable fourth score 0.7062.

The 0.75 candidate increases measured precision by returning fewer chunks, but 0.65 is preferred by the predeclared rule because it already eliminates the observed false positive while preserving more context. At 0.80, Recall@k and MRR fall to 0.50.

This diagnostic uses one source-verified unanswerable case and no held-out test split. It can identify the next engineering baseline but cannot establish a thesis-grade calibrated threshold.
