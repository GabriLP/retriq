# Experiment comparison

Generated: 2026-07-15T13:38:36.071Z

> **Preliminary comparison:** At least one legacy run does not record the loaded corpus snapshot hash.


| Experiment | Run | Status | Target words | Overlap | Chunks | Average words | P50 | P90 | Below minimum | Preparation ms | Corpus hash | Config hash |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| common-programming-word-300 | 20260715133815988-e053ac36 | prepared | 300 | 80 | 30455 | 173.66 | 126 | 344 | 17861 | 8587 | e44495f8 | e053ac36 |
| common-programming-word-450 | 20260715133806479-e05f02a6 | prepared | 450 | 80 | 27496 | 181.95 | 97 | 464 | 17861 | 8837 | e44495f8 | e05f02a6 |
| common-programming-word-850 | 20260715133757150-dcbd9035 | prepared | 850 | 80 | 25553 | 187.44 | 83 | 502 | 17861 | 8604 | e44495f8 | dcbd9035 |
| react-baseline-word-850 | 20260714084231-4ab94e7b | prepared | 850 | 80 | 230 | 825.12 | - | - | - | 6095 | - | 4ab94e7b |
| react-word-450 | 20260714084457-bc02b97f | prepared | 450 | 60 | 461 | 455.11 | - | - | - | 5777 | - | bc02b97f |

## Interpretation notes

- Compare retrieval/generation metrics only after runs use the same corpus snapshot and golden set.
- A dirty workspace is recorded in each run and should be avoided for final thesis measurements.
- Preparation metrics describe corpus segmentation; they do not measure retrieval quality by themselves.
- Chunk percentiles and below-minimum counts expose when source-section boundaries dominate the configured target size.
