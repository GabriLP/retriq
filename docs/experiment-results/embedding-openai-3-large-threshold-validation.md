# Threshold sweep 20260716144029996

- Status: **completed**
- Base experiment/run: `embedding-openai-3-large-1024` / `20260716141016626-aee6c695`
- Readiness: **exploratory** - Model selection uses the validation split only; the previously observed test split is excluded.
- Calibration split: **validation** (6 answerable + 6 unanswerable)
- Selected threshold: **0.18**
- Selection: No threshold eliminated false positives; selected the best candidate that satisfied the guardrails.
- Cache-only: yes

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 1.0000 | 0.6250 | 0.8333 | 0.8636 | 1.0000 | 48 |
| 0.30 | 1.0000 | 0.6250 | 0.8333 | 0.8636 | 1.0000 | 45 |
| 0.40 | 1.0000 | 0.6250 | 0.8333 | 0.8636 | 0.8333 | 44 |
| 0.45 | 1.0000 | 0.6250 | 0.8333 | 0.8636 | 0.8333 | 39 |
| 0.50 | 1.0000 | 0.6250 | 0.8333 | 0.8636 | 0.3333 | 29 |
| 0.55 | 1.0000 | 0.6250 | 0.8333 | 0.8636 | 0.1667 | 28 |
| 0.60 | 0.7500 | 0.5833 | 0.6667 | 0.6458 | 0.1667 | 15 |
| 0.65 | 0.3333 | 0.1667 | 0.2500 | 0.2718 | 0.0000 | 7 |
| 0.70 | 0.1667 | 0.1667 | 0.1667 | 0.1667 | 0.0000 | 1 |
| 0.75 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.80 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.85 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.90 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |

Score diagnostics: maximum unanswerable top score 0.6041, minimum answerable top score 0.5943, and minimum answerable fourth score 0.5554.

The threshold is selected exclusively on the validation split. The locked test split must be evaluated once, after this choice is recorded, and must not be used to revise the threshold.
