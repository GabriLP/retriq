# LLM judge calibration v1.1

- Judge: **openai/gpt-5.4-nano** via **OpenAI**, medium reasoning
- Human-reference rows: **72**; unique provider inputs: **48**
- Locked generation test touched: **no**
- Observed valid-response cost: **$0.046874**

| Split | Rows | Pooled core QWK | Quality Spearman | Binary pass agreement | Guardrails |
|---|---:|---:|---:|---:|---|
| calibration | 48 | 0.4320 | 0.3570 | 0.8333 | fail |
| audit | 24 | 0.1912 | 0.4948 | 0.7917 | fail |

## Decision

**FAIL** — Not eligible. Any new prompt or model requires a separate preregistered attempt.

The judge matched every abstention decision, and its calibration mean quality (0.9219) was close to the human mean (0.9271). This did not translate into reliable item ordering: calibration Spearman was only 0.3570. On the held-out audit, the judge was materially stricter (mean 0.8542 versus human 0.9740) and missed the kappa, correlation, and binary-agreement thresholds. Two intermittent provider responses without model identity were rejected and are recorded in the execution ledger.

A secondary human audit remains pending for 5 disagreements and 6 deterministically sampled agreements. The judge is not enabled in production.

## Interpretation limits

- The human reference has one reviewer and no inter-rater reliability estimate.
- The held-out audit is internal to validation and is not the locked generation test.
- Repeated deterministic abstentions share one provider judgment but remain separate generator-level agreement rows.
