# Held-out threshold test

- Experiment: `common-programming-word-300-test-threshold-075`
- Prepared run: `20260716104350157-99f3e520`
- Retrieval attempt: `20260716104406422-gemini-embedding-2`
- Git commit used by the run: `5bb9b861eaf76d07292065baf22adec9d91c0acc`
- Split: **locked test** (6 answerable + 6 unanswerable)
- Threshold: **0.75**, selected and committed from validation before this test was run

## Results

| Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR |
|---:|---:|---:|---:|---:|
| 1.0000 | 0.8611 | 1.0000 | 1.0000 | 0.1667 |

All six answerable questions retrieved relevant evidence, with relevant evidence ranked first. Five of the six unanswerable questions returned no chunks. The remaining negative, `postgresql-19-release-001`, returned four PostgreSQL 18 chunks; its top similarity was 0.765694. This is a near-domain/version false positive: semantic similarity alone recognizes PostgreSQL but does not reliably enforce the requested documentation version.

The threshold is not revised after observing the test result. Raising it now would tune the system on the held-out data and invalidate the test as an unbiased estimate. The failure is instead retained as evidence for a future, separately versioned experiment using version-aware metadata filtering or explicit query/corpus compatibility checks.

## Embedding usage

| Cache hits | API inputs | Provider requests | Estimated API tokens | Estimated API cost (USD) | Estimated avoided cost (USD) |
|---:|---:|---:|---:|---:|---:|
| 30,011 | 6 | 1 | 196 | 0.000039 | 1.784326 |

Costs use the recorded official standard price of $0.20 per million input tokens. They are planning estimates rather than provider billing records.
