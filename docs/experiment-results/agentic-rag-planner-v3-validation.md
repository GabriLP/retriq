# Bounded agentic RAG validation

- Protocol/attempt: `agentic-rag-planner-v3` / `20260722090144314`
- Parent run: `20260717084956473-e60c88ec`
- Split: **validation only**; locked test cases executed: **0**
- Decision: **single-pass-baseline**
- Failed preregistered checks: `generalUnanswerableFalsePositiveRate`, `comparativeBothEvidenceSideCoverageAt4`, `comparativeMeanEvidenceSideRecallAt4`

| Variant | Recall@4 | Precision@4 | MRR | nDCG@4 | General FPR | Both evidence sides | Evidence-side recall | Focused FPR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Single-pass baseline | 0.9630 | 0.6296 | 0.9444 | 0.9493 | 0.0000 | 0.2500 | 0.5625 | 0.3750 |
| Bounded Gemini planner | 0.9630 | 0.6296 | 0.9444 | 0.9493 | 0.1111 | 0.2500 | 0.3125 | 0.0000 |

## Operational guardrails

- Planner invocations/provider calls/cache hits: **40/40/0**
- Controlled recoveries invoked/succeeded: **0/0**
- Observed planner cost this run: **$0.090069**; analytical no-cache cost: **$0.090069**
- Incremental latency mean/p95/max: **1255 / 2515 / 2651 ms**
- Structured validity/provider errors: **1.0000 / 0**

## Interpretation

The agentic variant failed at least one preregistered requirement, so the frozen single-pass baseline remains selected. No post-hoc tuning is applied to this run.

## Limitations

- Validation and focused comparative cases have informed earlier experiments.
- The deterministic assessor checks score and requested-language coverage, not semantic entailment.
- Planner cache hits have zero observed provider cost in this run; analytical no-cache cost is reported separately.
- Generation quality and production enablement are outside this retrieval experiment.
