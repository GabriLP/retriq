# Semantic-gated agentic retrieval

- Split: **validation**; locked test executions: **0**
- Exploratory candidate qualified for a separate generation study: **no**
- Failed checks: **comparativeBothEvidence, comparativeSideRecall**

| Variant | Recall@4 | MRR | nDCG@4 | General FPR | Both evidence sides | Side recall | Focused FPR |
|---|---:|---:|---:|---:|---:|---:|---:|
| Single pass (historical) | 0.9630 | 0.9444 | 0.9493 | 0.0000 | 0.2500 | 0.5625 | 0.3750 |
| Deterministic agentic (historical) | 0.9630 | 0.9444 | 0.9493 | 0.1111 | 0.2500 | 0.3125 | 0.0000 |
| Semantic-gated agentic | 0.9630 | 0.9444 | 0.9493 | 0.0000 | 0.2500 | 0.3750 | 0.0000 |

- Assessor/planner calls: **49/39**
- Combined observed model cost: **$0.203783**
- Incremental latency mean/p95/max: **3893/7034/68088 ms**
- Second-attempt cases/recovered: **39/0**

This result cannot revise the failed component benchmark or enable production.
