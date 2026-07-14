# Experiment comparison

Generated: 2026-07-10T20:10:12.252Z

> **Preliminary comparison:** at least one run used a dirty workspace. Re-run from a clean commit for thesis measurements.


| Experiment | Run | Status | Target words | Overlap | Chunks | Avg. chunk words | Preparation ms | Config hash |
|---|---|---|---:|---:|---:|---:|---:|---|
| react-baseline-word-850 | 20260710200958-2faf2d74 | prepared | 850 | 80 | 230 | 825.12 | 6540 | 2faf2d74 |
| react-word-450 | 20260710201006-2269faf6 | prepared | 450 | 60 | 461 | 455.11 | 5666 | 2269faf6 |

## Interpretation notes

- Compare retrieval/generation metrics only after runs use the same corpus snapshot and golden set.
- A dirty workspace is recorded in each run and should be avoided for final thesis measurements.
- Preparation metrics describe corpus segmentation; they do not measure retrieval quality by themselves.
