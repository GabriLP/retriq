# Threshold sweep 20260716154537864

- Status: **completed**
- Base experiment/run: `embedding-google-gemini-2-word-450-1024` / `20260716152838041-5e1e0ade`
- Readiness: **exploratory** - Interaction selection uses validation only; a fresh untouched test split is still required.
- Calibration split: **validation** (6 answerable + 6 unanswerable)
- Selected threshold: **0.75**
- Selection: Lowest-ranked candidate after requiring zero no-answer false positives and applying the declared guardrails and tie-breakers.
- Cache-only: yes

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 1.0000 | 48 |
| 0.30 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 1.0000 | 48 |
| 0.40 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 1.0000 | 48 |
| 0.45 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 1.0000 | 48 |
| 0.50 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 1.0000 | 48 |
| 0.55 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 1.0000 | 48 |
| 0.60 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 0.8333 | 39 |
| 0.65 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 0.3333 | 32 |
| 0.70 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 0.3333 | 27 |
| 0.75 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 0.0000 | 22 |
| 0.80 | 0.5000 | 0.4167 | 0.5000 | 0.5000 | 0.0000 | 4 |
| 0.85 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.90 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |

Score diagnostics: maximum unanswerable top score 0.7184, minimum answerable top score 0.7738, and minimum answerable fourth score 0.7330.

The threshold is selected exclusively on the validation split. The locked test split must be evaluated once, after this choice is recorded, and must not be used to revise the threshold.
