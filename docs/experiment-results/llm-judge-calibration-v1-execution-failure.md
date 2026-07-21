# LLM judge calibration v1 — execution failure

- Status: **failed before agreement analysis**
- Provider requests attempted: **3**
- Valid responses cached: **2**
- Known provider-reported cost: **$0.0031475**, plus one request whose usage was not persisted
- Locked generation test touched: **no**

The third response was valid JSON but violated the task-specific nullability rule. Prompt v1 exposed a single schema where all scores were nullable, so strict structured output could not enforce the different shapes required by answerable and unanswerable tasks.

No agreement metric was computed and no human score was inspected to design the repair. The attempt is stopped rather than silently coercing the response. A separately preregistered successor may use distinct schemas for the two task types.
