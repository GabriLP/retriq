# Confirmatory generation human review

- Split: **test**
- Total cases: **48**
- Manual rows: **25** (24 answerable, 1 unanswerable)
- Deterministic abstentions: **23**
- Reviewer: **Gabriele**
- Automatic checks: **PASS**
- Human quality confirmation: **PASS**

| Metric | Result |
|---|---:|
| Normalized grounded quality | 0.9870 |
| Groundedness | 3.917 |
| Key-fact coverage | 3.917 |
| Citation correctness | 3.958 |
| Citation completeness | 4.000 |
| Directness | 1.958 |
| Correct abstention | 1.000 |
| Critical unsupported-claim rate | 0.0000 |
| Contradiction rate | 0.0000 |
| Invalid citation-label rate | 0.0000 |
| Generator-failure rate | 0.0000 |

- One thesis-author reviewer; inter-rater reliability is not estimated.
- Automatic adjudication is limited to 23 deterministic no-evidence responses; all 25 model-generated answers received manual review.
- The human review confirms only the frozen GLM output and was not used to tune or regenerate it.
