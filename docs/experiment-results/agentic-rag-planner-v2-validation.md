# Agentic planner v2: controlled recovery failure

- Split: **validation only**; locked test cases executed: **0**
- Completed before failure: **10/70**
- Partial retrieval metrics calculated or inspected: **no**
- Planner invocations/provider calls/recoveries: **2/3/1**
- Observed provider cost: **$0.007302**

## Diagnosis

The raw-response audit identified `MAX_TOKENS` as the concrete cause.

The initial response consumed 147 reasoning tokens and 93 visible completion tokens. It contained the intended strategy and two queries, but was truncated halfway through the rationale before closing the JSON object. The single formatting recovery then consumed 242 reasoning tokens and emitted only `Here is the JSON requested` before reaching the same 256-token limit.

The recovery mechanism therefore behaved as designed, but could not overcome an output budget that also includes hidden reasoning. V2 failed its preregistered perfect-recovery and zero-error requirements, so the single-pass baseline remains selected.

## Next controlled experiment

The next variant should keep every semantic and retrieval setting unchanged and increase only `maxOutputTokens` from 256 to 512. This is supported by the captured failure evidence and must use a new preregistered protocol rather than rewriting v2.
