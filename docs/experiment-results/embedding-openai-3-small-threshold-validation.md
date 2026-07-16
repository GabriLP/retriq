# Threshold sweep 20260716144026745

- Status: **completed**
- Base experiment/run: `embedding-openai-3-small-1024` / `20260716141026073-70a2d604`
- Readiness: **exploratory** - Model selection uses the validation split only; the previously observed test split is excluded.
- Calibration split: **validation** (6 answerable + 6 unanswerable)
- Selected threshold: **0.18**
- Selection: No threshold eliminated false positives; selected the best candidate that satisfied the guardrails.
- Cache-only: yes

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 0.8333 | 0.2917 | 0.6389 | 0.7003 | 1.0000 | 48 |
| 0.30 | 0.8333 | 0.2917 | 0.6389 | 0.7003 | 1.0000 | 48 |
| 0.40 | 0.8333 | 0.2917 | 0.6389 | 0.7003 | 0.8333 | 44 |
| 0.45 | 0.8333 | 0.2917 | 0.6389 | 0.7003 | 0.3333 | 32 |
| 0.50 | 0.8333 | 0.2917 | 0.6389 | 0.7003 | 0.3333 | 30 |
| 0.55 | 0.8333 | 0.4167 | 0.6389 | 0.7003 | 0.1667 | 25 |
| 0.60 | 0.3333 | 0.1667 | 0.3333 | 0.3333 | 0.1667 | 14 |
| 0.65 | 0.3333 | 0.3333 | 0.3333 | 0.3333 | 0.0000 | 4 |
| 0.70 | 0.1667 | 0.1667 | 0.1667 | 0.1667 | 0.0000 | 1 |
| 0.75 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.80 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.85 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.90 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |

Score diagnostics: maximum unanswerable top score 0.6308, minimum answerable top score 0.5527, and minimum answerable fourth score 0.5452.

The threshold is selected exclusively on the validation split. The locked test split must be evaluated once, after this choice is recorded, and must not be used to revise the threshold.
