# Generation benchmark human review guide v1

This guide defines the reference labels used later to calibrate LLM-as-a-judge. It must be applied without knowing which generator produced an answer.

## Review order

1. Read the question and frozen evidence.
2. Read the expected key facts. Treat them as coverage targets, not text that the answer must reproduce verbatim.
3. Score every rubric dimension independently.
4. Mark each binary failure flag.
5. Add a short rationale identifying unsupported claims, missing facts, and citation errors.
6. Do not revise a label after seeing an automatic judge score.

## Blinding and provenance

- Answers receive randomized opaque labels; provider and model names are hidden from the reviewer.
- The 24-case calibration subset is selected deterministically before any model outputs exist.
- The same human labels may calibrate judge prompts, but they must not be used as hidden test evidence.
- All current benchmark approvals are provisional until independently confirmed by the user.

## Material claims

A material claim changes the technical answer: API behavior, version constraints, causal explanations, algorithms, guarantees, requirements, or code semantics. Stylistic phrasing and harmless connective text are not material claims.

## Citation rules

- A citation is correct only when the cited frozen excerpt supports the associated claim.
- A correct source cited at the end of an unrelated paragraph does not automatically support every claim in that paragraph.
- A citation label not present in the frozen evidence is invalid.
- Reference answers and expected key facts are not citable sources.

## Abstention

When retrieval returns no evidence, the pipeline uses a deterministic response and does not invoke the generator. Mark correct abstention only when the response declines to answer and adds no unsupported technical detail.

## Limitation

The initial reference set has one primary human reviewer. Judge agreement therefore measures agreement with that reviewer, not population-wide inter-rater reliability. A second independent reviewer should later audit at least the disagreements and a random sample of agreements.
