# Threshold sweep 20260716104301524

- Status: **completed**
- Base experiment/run: `common-programming-word-300-validation` / `20260716104232129-aad7c6f9`
- Readiness: **exploratory** - Calibration uses six answerable and six verified negatives; the separately locked test split remains untouched until selection is recorded. Human approval is still pending.
- Calibration split: **validation** (6 answerable + 6 unanswerable)
- Selected threshold: **0.75**
- Selection: Lowest-ranked candidate after requiring zero no-answer false positives and applying the declared guardrails and tie-breakers.
- Cache-only: yes

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 1.0000 | 0.6667 | 1.0000 | 1.0000 | 1.0000 | 48 |
| 0.40 | 1.0000 | 0.6667 | 1.0000 | 1.0000 | 1.0000 | 48 |
| 0.50 | 1.0000 | 0.6667 | 1.0000 | 1.0000 | 1.0000 | 48 |
| 0.55 | 1.0000 | 0.6667 | 1.0000 | 1.0000 | 1.0000 | 48 |
| 0.60 | 1.0000 | 0.6667 | 1.0000 | 1.0000 | 0.8333 | 39 |
| 0.65 | 1.0000 | 0.6667 | 1.0000 | 1.0000 | 0.3333 | 32 |
| 0.70 | 1.0000 | 0.6667 | 1.0000 | 1.0000 | 0.3333 | 32 |
| 0.75 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 0.0000 | 20 |
| 0.80 | 0.5000 | 0.4167 | 0.5000 | 0.5000 | 0.0000 | 4 |

Score diagnostics: maximum unanswerable top score 0.7165, minimum answerable top score 0.7822, and minimum answerable fourth score 0.7356.

The threshold is selected exclusively on the validation split. The locked test split must be evaluated once, after this choice is recorded, and must not be used to revise the threshold.
