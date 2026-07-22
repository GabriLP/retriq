# Cross-attempt evidence accumulation

- Split: **validation**; locked test executions: **0**
- Candidate qualified for a separate generation study: **no**
- Failed checks: **comparativeBothEvidence, comparativeSideRecall, focusedFpr**

| Variant | Recall@4 | MRR | nDCG@4 | General FPR | Both evidence sides | Side recall | Focused FPR |
|---|---:|---:|---:|---:|---:|---:|---:|
| Replace on retry (historical) | 0.9630 | 0.9444 | 0.9493 | 0.0000 | 0.2500 | 0.3750 | 0.0000 |
| Balanced cross-attempt accumulation | 0.9630 | 0.9444 | 0.9493 | 0.0000 | 0.2500 | 0.5000 | 0.1250 |

- Assessor/planner calls: **6/0**
- Combined observed model cost: **$0.019962**
- Incremental latency mean/p95/max: **376/3951/6123 ms**
- Second-attempt cases/recovered: **39/4**

This is the final Agentic RAG architecture experiment for the current thesis.
