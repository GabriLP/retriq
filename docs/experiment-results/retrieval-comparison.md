# Retrieval comparison

Generated: 2026-07-14T08:46:44.997Z

> **Preliminary:** only source-verified seed cases are included. Final thesis tables require a larger human-approved set. 1 invalidated attempt(s) were retained locally and excluded here.

| Experiment | Chunks | Embedding | k | Recall@k | Precision@k | MRR | nDCG@k | No-answer FPR | Embedding ms |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| react-baseline-word-850 | 230 | gemini-embedding-2 | 4 | 1.0000 | 0.4375 | 1.0000 | 0.9799 | 1.0000 | 22594 |
| react-word-450 | 461 | gemini-embedding-2 | 4 | 1.0000 | 0.7500 | 0.8750 | 0.8877 | 1.0000 | 42635 |

## Current interpretation

- Both word-window variants retrieve at least one expected source for every answerable seed case.
- The 450-word variant has higher chunk-level precision, while the 850-word baseline has higher MRR and nDCG on this small sample.
- Both variants retrieve unrelated context for the negative case at threshold 0.18, so threshold calibration and stronger abstention logic are required.
- No chunking choice is accepted yet: the sample is too small, does not yet cover the full PDF corpus, and has no human-approved cases.
