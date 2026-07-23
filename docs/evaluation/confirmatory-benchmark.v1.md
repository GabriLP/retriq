# Confirmatory benchmark v1

## Purpose

This benchmark remedies two limitations of the first final test without altering
or rerunning its historical results:

- the first final test contained only 24 cases;
- its inherited labels were marked `pending-confirmation`.

The 24-case result remains an exploratory/preliminary result. This benchmark is
a separate confirmatory study and contains 48 previously unused questions.

## Design

- 12 documented domains;
- 4 cases per domain;
- 2 answerable and 2 unanswerable cases per domain;
- 24 answerable and 24 unanswerable cases overall;
- no exact or high-overlap question reused from the existing golden set,
  retrieval final test, or generation benchmark;
- answerable labels are linked to frozen corpus chunks;
- unanswerable labels include a scope rationale and zero-match corpus probes.

Phrase probes are supporting evidence, not a semantic proof of absence. The
author must therefore confirm every positive and negative label in the review
desk.

## Leakage control

No retrieval, generator, agent, or judge is run while the benchmark has status
`awaiting-human-confirmation`. The review seed is explicitly unlocked. The
finalization script refuses to create a locked benchmark if:

- any of the 48 rows is missing;
- any decision is empty or `needs-correction`;
- reviewer provenance is absent;
- the review refers to another benchmark version.

After all cases are approved, the finalizer creates the immutable input for the
confirmatory retrieval and generation run. That run must be executed once with
the configuration selected on validation data.

## Reproducible workflow

```text
npm run benchmark:confirmatory:build
npm run benchmark:confirmatory:validate

# Review in the browser:
# /evaluation/confirmatory-benchmark-review

npm run benchmark:confirmatory:finalize -- <completed-review.csv>
npm run benchmark:confirmatory:validate -- docs/evaluation/confirmatory-benchmark.v1.json
```

The review seed is
`docs/evaluation/confirmatory-benchmark.v1.review.json`. The locked output does
not exist until the author has approved all 48 cases.
