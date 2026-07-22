# Semantic evidence assessor v2 disagreement audit

This is a post-result qualitative audit. It does **not** change the frozen AI-assisted reference or the preregistered decision.

All three disagreements are semantic-assessor positives on packets labelled insufficient. There are no false negatives.

| State | Frozen label | Model | Qualitative finding |
|---|---:|---:|---|
| `evidence-v2-postgresql-where-having::incomplete` | 0 | 1 | The excerpts state that `WHERE` filters before aggregation and that `HAVING` filters grouped rows using aggregate results. This appears to cover the expected distinction. |
| `evidence-v2-python-generator-suspension::incomplete` | 0 | 1 | The excerpts identify preserved locals, instruction position, evaluation stack and exception state, and explain resumption at `yield`. This appears to cover the expected execution state. |
| `evidence-v2-rust-refcell-runtime::incomplete` | 0 | 1 | The excerpts contrast compile-time reference checks with runtime `RefCell<T>` checks and panic on violation. This appears to cover the expected distinction. |

The model therefore failed the frozen numerical guardrails, but the error pattern also exposes a likely benchmark-construction problem: these three “incomplete” packets appear semantically sufficient. Because the final reference labels were entered with case-level AI assistance and exactly reproduce the construction labels, changing them after observing model predictions would be circular. The defensible thesis treatment is to retain the failed preregistered result, disclose the ambiguity, and avoid claiming either independent human validation or a reliable 25% real-world false-positive rate.
