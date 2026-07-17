# Human generation review v1

- Split: **validation**
- Human-reference rows: **72** (36 answerable, 36 unanswerable)
- Reviewer: **Gabriele**
- Review status: **complete-single-reviewer-reference**
- Source SHA-256: `793f0b4563459026a09e0fb0117cc8aadc7cf6ee2c6f0f27c7dc70a258e6835b`
- Locked test split touched: **no**

| Generator | Quality (0-1) | Grounded | Coverage | Citation correctness | Citation completeness | Directness | Abstention | Failure rate | All guardrails | Cost USD | Median ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| gemini-3.5-flash-direct | 0.9219 | 3.833 | 3.500 | 3.833 | 3.583 | 1.667 | 1.000 | 4.17% | fail | 0.164763 | 1772.89 |
| glm-5.2-openrouter-baseten-fp8 | 0.9740 | 4.000 | 3.750 | 3.917 | 3.917 | 1.833 | 1.000 | 0.00% | pass | 0.069270 | 3454.26 |
| grok-4.5-openrouter-xai | 0.9323 | 3.917 | 3.667 | 3.750 | 3.583 | 1.583 | 1.000 | 0.00% | pass | 0.171426 | 5216.25 |

## Validation decision

**glm-5.2-openrouter-baseten-fp8** is selected under the preregistered validation rule: Highest mean normalized grounded answer quality among candidates passing every preregistered guardrail; cost and median latency break ties. The selection still requires one final confirmation on the untouched test split after judge calibration is frozen.

Gemini's single generator failure produces a 4.17% failure rate over its 24 reviewed rows, above the preregistered 2% maximum. Operational generation errors were zero; this flag is a human quality assessment of the produced answer.

## Limitations

- The reference labels were produced by one human reviewer and therefore do not estimate inter-rater reliability.
- The review was completed quickly; a second reviewer should audit judge disagreements and a random sample of agreements.
- These validation labels may calibrate judge prompts but must not be reused as hidden test evidence.
