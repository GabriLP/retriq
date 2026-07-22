# Semantic evidence assessor v2

The frozen reference is **AI-assisted human review**, not an independent human gold standard.

| Assessor | Accuracy | Balanced accuracy | Precision | Recall | Specificity | FPR | Kappa |
|---|---:|---:|---:|---:|---:|---:|---:|
| Deterministic | 0.5000 | 0.5000 | 0.5000 | 1.0000 | 0.0000 | 1.0000 | 0.0000 |
| GPT-5.4 Mini semantic | 0.8750 | 0.8750 | 0.8000 | 1.0000 | 0.7500 | 0.2500 | 0.7500 |

- Provider calls: **24**; cache hits: **0**; errors: **0**
- Cost: **$0.047516**
- P95 latency: **4258 ms**
- Qualified for one end-to-end experiment: **no**
- Failed checks: **accuracy, falsePositiveRate**
