# Generation output-budget comparison

- Protocol/attempt: `generation-output-budget-v1` / `20260721085249531`
- Split: **validation only**
- Decision: **accept-2048-for-runtime-reliability**
- Quality status: **pending-blinded-human-review-or-calibrated-judge**
- Locked test touched: **no**

| Variant | Max tokens | Generated | Errors | Finish reasons | MAX_TOKENS | Confirmed near-budget abrupt stops | Completion tokens | Reasoning tokens | Cost USD | Median ms | Median chars |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| budget-900-frozen | 900 | 27 | 0 | 0 | 0 | 1 | 5012 | 4532 | 0.164763 | 1772.89 | 599 |
| budget-2048 | 2048 | 27 | 0 | 27 | 0 | 0 | 5471 | 4280 | 0.166626 | 1796.50 | 691 |

## Known regression

`rust-ownership-move-clone-001` is the human-confirmed 900-token Gemini failure. Its candidate stop reason is `STOP` and candidate truncation flag is `false`.

## Decision rationale

All validation calls stopped naturally, the known 900-token regression completed, and no operational errors occurred. Quality remains a separate pending assessment.

Completion reliability does not establish answer quality. The generated blinded review package must be used for human assessment or retained until an independently calibrated judge is available.

## Limitations

- Legacy provider finish reasons were not stored, so its truncation count is a confirmed lower bound based on human failure labels, near-budget usage, and an abrupt ending.
- Temperature zero does not guarantee byte-identical regeneration across provider revisions.
- Completion reliability, cost, and latency do not establish answer quality.
- The locked test split was not accessed.
