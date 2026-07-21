# Comparative query decomposition

- Protocol/attempt: `comparative-query-decomposition-v1` / `20260721092530477`
- Evaluation commit: `9d47585320e42eab40fd7786041a1474d1ef5eee`
- Split: **validation only**; locked test touched: **no**
- Fixed: cosine >= 0.68, maximum four chunks, no reranker
- New subquery provider inputs: **32**, estimated cost **$0.00014300**

| Variant | Both languages @4 | Both evidence sides @4 | Evidence-side recall | Side MRR | Negative FPR | Positive gate rejects | Negative gate rejects |
|---|---:|---:|---:|---:|---:|---:|---:|
| balanced-single-query | 0.6250 | 0.2500 | 0.5000 | 0.3646 | 0.3750 | 0 | 5 |
| decomposed-any-side | 1.0000 | 0.3750 | 0.6250 | 0.4271 | 0.5000 | 0 | 8 |
| decomposed-both-sides-gate | 1.0000 | 0.3750 | 0.6250 | 0.4271 | 0.0000 | 0 | 8 |

## Decision

**decomposed-both-sides-gate.** Selected by the preregistered validation rule.

## Limitations

- Subqueries are manually frozen deterministic rewrites, not generated dynamically.
- The both-sides gate measures score eligibility, not semantic entailment.
- Eight positive and eight negative validation cases remain a focused benchmark.
- Production behavior and the locked general test split remain untouched.
