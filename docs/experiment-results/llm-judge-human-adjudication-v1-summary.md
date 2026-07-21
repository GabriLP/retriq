# Judge human adjudication v1

- Completed rows: **15** (12 answerable, 3 unanswerable)
- Decisions: **14** confirmed independent, **1** revised to judge
- Phase-one-to-final score changes: **1**
- Provider requests: **0**

## Agreement sensitivity

| Reference on selected 15 | QWK | Quality Spearman | Pass agreement | Exact full-label agreement |
|---|---:|---:|---:|---:|
| Original human vs judge | 0.1912 | 0.4948 | 0.6667 | 0.6000 |
| New phase-one vs judge | 0.5556 | 0.9558 | 0.7333 | 0.6667 |
| Final adjudicated vs judge | 0.6407 | 0.9214 | 0.8000 | 0.7333 |

## Recomputed 24-row audit

After replacing the 12 answerable labels with their final adjudicated values and retaining the 12 original unanswerable rows:

- Pooled core QWK: **0.6407**
- Answerable quality Spearman: **0.9214**
- Binary pass agreement: **0.8750**
- Mean adjudicated quality: **0.9271**
- Mean judge quality: **0.8542**

These are sensitivity-analysis metrics, not a replacement independent gold standard. GPT-5.4 Nano remains ineligible for production because the unchanged calibration split still fails the frozen QWK and Spearman thresholds.

## Methodological limitation

The same reviewer produced the original and adjudicated labels and consulted Codex for case-by-case guidance during phase one. The result is therefore a useful human-in-the-loop error audit, but not an independent second-human replication. The audit has also now been inspected and cannot be reused as an untouched set for tuning another judge prompt.
