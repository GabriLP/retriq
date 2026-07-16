# Threshold sweep 20260716145801676

- Status: **completed**
- Base experiment/run: `embedding-voyage-code-3-1024` / `20260716141035921-e17adeeb`
- Readiness: **exploratory** - Model selection uses the validation split only; the previously observed test split is excluded.
- Calibration split: **validation** (6 answerable + 6 unanswerable)
- Selected threshold: **0.6**
- Selection: Lowest-ranked candidate after requiring zero no-answer false positives and applying the declared guardrails and tie-breakers.
- Cache-only: yes

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 0.9167 | 0.4167 | 0.7222 | 0.7292 | 1.0000 | 48 |
| 0.30 | 0.9167 | 0.4167 | 0.7222 | 0.7292 | 1.0000 | 48 |
| 0.40 | 0.9167 | 0.4167 | 0.7222 | 0.7292 | 0.8333 | 43 |
| 0.45 | 0.9167 | 0.4167 | 0.7222 | 0.7292 | 0.8333 | 39 |
| 0.50 | 0.9167 | 0.4167 | 0.7222 | 0.7292 | 0.6667 | 36 |
| 0.55 | 0.9167 | 0.4167 | 0.7222 | 0.7292 | 0.1667 | 28 |
| 0.60 | 0.9167 | 0.4306 | 0.7222 | 0.7292 | 0.0000 | 21 |
| 0.65 | 0.5000 | 0.2222 | 0.3333 | 0.3770 | 0.0000 | 9 |
| 0.70 | 0.1667 | 0.0833 | 0.0833 | 0.1052 | 0.0000 | 4 |
| 0.75 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 1 |
| 0.80 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.85 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.90 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |

Score diagnostics: maximum unanswerable top score 0.5884, minimum answerable top score 0.6158, and minimum answerable fourth score 0.5521.

The threshold is selected exclusively on the validation split. The locked test split must be evaluated once, after this choice is recorded, and must not be used to revise the threshold.
