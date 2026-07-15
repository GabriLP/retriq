# Experiment comparison

Generated: 2026-07-15T13:28:18.408Z

> **Preliminary comparison:** At least one legacy run does not record the loaded corpus snapshot hash.


| Experiment | Run | Status | Target words | Overlap | Chunks | Avg. chunk words | Preparation ms | Corpus hash | Config hash |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| react-baseline-word-850 | 20260714084231-4ab94e7b | prepared | 850 | 80 | 230 | 825.12 | 6095 | - | 4ab94e7b |
| react-word-450 | 20260714084457-bc02b97f | prepared | 450 | 60 | 461 | 455.11 | 5777 | - | bc02b97f |

## Interpretation notes

- Compare retrieval/generation metrics only after runs use the same corpus snapshot and golden set.
- A dirty workspace is recorded in each run and should be avoided for final thesis measurements.
- Preparation metrics describe corpus segmentation; they do not measure retrieval quality by themselves.
