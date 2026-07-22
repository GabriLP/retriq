# Semantic evidence human review v1

- Reviewed disagreements: **3**
- Human decisions: **3 sufficient**, **0 insufficient**
- Semantic assessor agreement on reviewed cases: **1.0000**
- Deterministic gate agreement on reviewed cases: **0.6667**
- Locked test touched: **no**
- Human-review SHA-256: `22e42dd1749694da6a0b219ad470c80f584956b4275d9c7f0e5e3b50c2d5b672`

| Reference | Assessor | Accuracy | Recall | FPR | Errors |
|---|---|---:|---:|---:|---:|
| Frozen canonical | Deterministic | 0.9545 | 1.0000 | 0.0610 | 5 |
| Frozen canonical | GPT-5.4 Mini semantic | 0.9727 | 1.0000 | 0.0366 | 3 |
| Human-adjudicated sensitivity | Deterministic | 0.9636 | 0.9677 | 0.0380 | 4 |
| Human-adjudicated sensitivity | GPT-5.4 Mini semantic | 1.0000 | 1.0000 | 0.0000 | 0 |

## Case decisions

- `python-parameter-kinds-001::attempt-1`: **sufficient**; deterministic sufficient; semantic sufficient.
- `compare-javascript-typescript-type-errors::attempt-1`: **sufficient**; deterministic insufficient; semantic sufficient.
- `compare-java-cpp-multiple-inheritance::attempt-1`: **sufficient**; deterministic sufficient; semantic sufficient.

## Interpretation

All three apparent semantic false positives were judged sufficient. Under the adjudicated sensitivity reference, the semantic assessor is perfect on the 110 frozen states and the deterministic gate still makes four errors. The original canonical-label result remains immutable and the assessor is **not selected retroactively**. This review supports preregistering a new end-to-end experiment with semantically defined evidence labels.

## Limitations

- The same primary reviewer who developed the benchmark completed this adjudication.
- The reviewer consulted Codex while interpreting the three cases, so this is AI-assisted human adjudication rather than an independent second-human replication.
- Only model disagreements were reviewed, which is appropriate for error analysis but cannot estimate agreement over the complete state distribution.
- The reviewed validation states are now inspected and cannot serve as untouched evidence for subsequent model selection.

## Next step

Preregister a new end-to-end semantic-assessor Agentic RAG experiment and evaluate it on newly reserved or independently reviewed evidence states before production selection.
