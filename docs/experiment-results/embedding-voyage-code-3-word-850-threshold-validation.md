# Threshold sweep 20260716154546236

- Status: **completed**
- Base experiment/run: `embedding-voyage-code-3-word-850-1024` / `20260716152904972-9f0d304f`
- Readiness: **exploratory** - Interaction selection uses validation only; a fresh untouched test split is still required.
- Calibration split: **validation** (6 answerable + 6 unanswerable)
- Selected threshold: **0.6**
- Selection: Lowest-ranked candidate after requiring zero no-answer false positives and applying the declared guardrails and tie-breakers.
- Cache-only: yes

| Threshold | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Returned chunks |
|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 0.9167 | 0.4167 | 0.6111 | 0.6781 | 1.0000 | 48 |
| 0.30 | 0.9167 | 0.4167 | 0.6111 | 0.6781 | 1.0000 | 48 |
| 0.40 | 0.9167 | 0.4167 | 0.6111 | 0.6781 | 0.8333 | 43 |
| 0.45 | 0.9167 | 0.4167 | 0.6111 | 0.6781 | 0.6667 | 37 |
| 0.50 | 0.9167 | 0.4167 | 0.6111 | 0.6781 | 0.6667 | 35 |
| 0.55 | 0.9167 | 0.4167 | 0.6111 | 0.6781 | 0.1667 | 26 |
| 0.60 | 0.9167 | 0.5139 | 0.6111 | 0.6781 | 0.0000 | 20 |
| 0.65 | 0.5000 | 0.2222 | 0.3333 | 0.3770 | 0.0000 | 9 |
| 0.70 | 0.1667 | 0.0833 | 0.0833 | 0.1052 | 0.0000 | 4 |
| 0.75 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.80 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.85 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |
| 0.90 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 |

Score diagnostics: maximum unanswerable top score 0.5900, minimum answerable top score 0.6206, and minimum answerable fourth score 0.5055.

The threshold is selected exclusively on the validation split. The locked test split must be evaluated once, after this choice is recorded, and must not be used to revise the threshold.
