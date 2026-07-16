# Threshold sweep 20260716175134811

- Status: **completed**
- Base experiment/run: `baseline-gemini-300-v2-validation` / `20260716175046643-70de10e9`
- Readiness: **exploratory** - All 24 validation cases have provisional human approval; independent confirmation is pending. The six-case fresh test remains untouched.
- Calibration split: **validation** (12 answerable + 12 unanswerable)
- Selected threshold: **0.18**
- Selection: No threshold eliminated false positives; selected the best candidate that satisfied the guardrails.
- Cache-only: yes

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 1.0000 | 96 |
| 0.30 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 1.0000 | 96 |
| 0.40 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 1.0000 | 96 |
| 0.45 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 1.0000 | 96 |
| 0.50 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 1.0000 | 96 |
| 0.55 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 1.0000 | 96 |
| 0.60 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 0.7500 | 76 |
| 0.65 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 0.3333 | 62 |
| 0.70 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 0.2500 | 59 |
| 0.72 | 1.0000 | 0.7708 | 1.0000 | 1.0000 | 0.0833 | 50 |
| 0.74 | 1.0000 | 0.7708 | 1.0000 | 1.0000 | 0.0833 | 47 |
| 0.75 | 1.0000 | 0.7847 | 1.0000 | 1.0000 | 0.0833 | 46 |
| 0.76 | 1.0000 | 0.8125 | 1.0000 | 1.0000 | 0.0833 | 39 |
| 0.78 | 0.8750 | 0.8056 | 0.9167 | 0.9167 | 0.0000 | 25 |
| 0.80 | 0.5000 | 0.4306 | 0.5000 | 0.5000 | 0.0000 | 10 |
| 0.85 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.90 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |

Score diagnostics: maximum unanswerable top score 0.7615, minimum answerable top score 0.7611, and minimum answerable fourth score 0.7105.

The threshold is selected exclusively on the validation split. The locked test split must be evaluated once, after this choice is recorded, and must not be used to revise the threshold.
