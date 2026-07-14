# Golden set summary

- Dataset: `retriq-programming-qa@1.1.0-seed`
- Cases: **16**
- Scorable now: **13**

## Coverage

| Dimension | Distribution |
|---|---|
| Status | draft: 3; source-verified: 13 |
| Language/domain | C: 2; Java: 7; PostgreSQL: 2; React: 5 |
| Difficulty | easy: 4; hard: 6; medium: 6 |
| Answerability | answerable: 15; unanswerable: 1 |

## Case inventory

| Case | Status | Language | Difficulty | Type | Answerability |
|---|---|---|---|---|---|
| react-state-snapshot-001 | source-verified | React | medium | factual | answerable |
| react-state-queue-001 | source-verified | React | medium | procedural | answerable |
| react-effects-001 | source-verified | React | medium | comparative | answerable |
| react-refs-001 | source-verified | React | easy | factual | answerable |
| react-out-of-scope-001 | source-verified | React | easy | unanswerable | unanswerable |
| c-standard-purpose-001 | source-verified | C | easy | factual | answerable |
| java-spec-release-001 | source-verified | Java | easy | factual | answerable |
| java-ods-arraystack-amortized-001 | source-verified | Java | hard | multi-hop | answerable |
| java-ods-dual-array-deque-001 | source-verified | Java | hard | multi-hop | answerable |
| java-ods-skiplist-analysis-001 | source-verified | Java | medium | factual | answerable |
| java-ods-linear-probing-001 | source-verified | Java | hard | factual | answerable |
| java-ods-red-black-tree-001 | source-verified | Java | hard | multi-hop | answerable |
| postgresql-license-001 | source-verified | PostgreSQL | medium | factual | answerable |
| c-array-decay-001 | draft | C | hard | factual | answerable |
| java-overload-resolution-001 | draft | Java | hard | procedural | answerable |
| postgresql-transaction-001 | draft | PostgreSQL | medium | factual | answerable |

Draft cases are candidates only. A model or script may propose them, but they enter scored thesis measurements only after source verification and, for the final benchmark, human approval.
