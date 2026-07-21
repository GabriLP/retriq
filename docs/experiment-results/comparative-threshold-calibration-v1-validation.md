# Comparative-query threshold calibration

- Protocol/attempt: `comparative-threshold-calibration-v1` / `20260721091627590`
- Evaluation commit: `92e1dfc4b8507bee98cb44942cbd0a62de913a3a`
- Split: **validation only**; locked test touched: **no**
- Cases: **8 answerable + 8 unanswerable**
- Changed variable: minimum cosine threshold
- Fixed: balanced multi-technology retrieval, topK=4, no reranker
- Provider inputs this run: **8**, estimated cost **$0.00003940**

| Threshold | Both languages @4 | Both evidence sides @4 | Evidence-side recall | Side MRR | Negative FPR | Positive chunks | Negative chunks |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.60 | 1.0000 | 0.5000 | 0.6875 | 0.4271 | 1.0000 | 32 | 32 |
| 0.62 | 1.0000 | 0.5000 | 0.6875 | 0.4271 | 1.0000 | 32 | 32 |
| 0.64 | 1.0000 | 0.3750 | 0.6250 | 0.4115 | 1.0000 | 32 | 32 |
| 0.66 | 0.7500 | 0.3750 | 0.5625 | 0.3802 | 0.8750 | 32 | 24 |
| 0.68 | 0.6250 | 0.2500 | 0.5000 | 0.3646 | 0.3750 | 31 | 8 |
| 0.70 | 0.3750 | 0.1250 | 0.4375 | 0.3333 | 0.1250 | 24 | 4 |
| 0.72 | 0.1250 | 0.1250 | 0.3125 | 0.2500 | 0.0000 | 16 | 0 |
| 0.74 | 0.1250 | 0.1250 | 0.1875 | 0.1563 | 0.0000 | 8 | 0 |

## Decision

**No threshold selected**. Select no threshold if none satisfies every eligibility condition; do not relax guardrails after observing results.

## Score diagnostics

- Maximum negative top score: 0.7122
- Minimum positive top score: 0.7004
- Minimum best score for the weaker positive language side: 0.6441

## Limitations

- Eight positive and eight negative comparative validation cases remain a focused calibration set.
- Exact absence probes are sanity checks rather than semantic proof.
- Only the cosine threshold changes; topK remains four.
- The locked general test split remains untouched.
