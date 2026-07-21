# LLM judge calibration v2

- Judge: **openai/gpt-5.4-mini**, medium reasoning, OpenAI pinned through OpenRouter
- Scope: **calibration only** (48 rows; 32 unique inputs)
- Old audit touched: **no**
- Locked generation test touched: **no**
- Observed cost: **$0.110033**

| Metric | Result | Threshold | Pass |
|---|---:|---:|---|
| Pooled core QWK | 0.5975 | 0.6000 | no |
| Quality Spearman | 0.4893 | 0.7000 | no |
| Binary pass agreement | 0.9375 | 0.8000 | yes |
| Provider errors | 0 | 0 | yes |

## Decision

**FAIL** - Keep automatic judging disabled; do not access an audit set.

## Interpretation limits

- The frozen calibration reference has one human reviewer and no inter-rater reliability estimate.
- The later human adjudication did not independently relabel the calibration rows.
- Passing calibration establishes eligibility for a new audit, not production validity.
