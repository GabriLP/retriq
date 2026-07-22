# Semantic evidence assessor validation

- Frozen v3 retrieval states: **110** (28 sufficient, 82 insufficient)
- Provider calls: **48**
- Observed cost: **$0.111858**
- P95 provider latency: **3877 ms**
- Selected for end-to-end integration: **no**

| Assessor | Accuracy | Recall | FPR |
|---|---:|---:|---:|
| Deterministic score/language | 0.9545 | 1.0000 | 0.0610 |
| GPT-5.4 Mini semantic | 0.9727 | 1.0000 | 0.0366 |

Failed checks: falsePositiveRate.
