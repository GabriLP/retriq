# Bounded agentic RAG validation: failed execution

- Protocol: `agentic-rag-planner-v1`
- Evaluation commit: `c4797f8182cf0782b40c3835c1d5dbca996e3e2f`
- Split: **validation only**; locked test cases executed: **0**
- Planned cases: **70**; completed before failure: **10**
- Partial retrieval metrics calculated or inspected: **no**

## Outcome

Gemini 3.5 Flash returned an output that failed the preregistered JSON parser. The protocol required an invalid planner output to fail the attempt without coercion, and allowed zero provider errors. The candidate therefore failed its operational guardrails and the single-pass baseline remains selected.

The run was not silently retried and no retrieval metric was calculated on the incomplete sample.

## Observed operational accounting

One earlier planner response was successfully parsed and cached: 159 prompt tokens, 81 completion tokens, 110 reasoning tokens, 350 total tokens, and an estimated cost of **$0.0019575**. Token usage and cost for the invalid response are unavailable because it was not persisted before the parser rejected it.

## Interpretation for the thesis

This is a valid negative experimental result: schema-constrained generation did not guarantee perfect end-to-end structured-output reliability in this run. A later variant may add a separately preregistered robustness mechanism, but it must be reported as a new experiment rather than as a repair of this result.
