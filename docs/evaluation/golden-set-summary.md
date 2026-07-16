# Golden set summary

- Dataset: `retriq-programming-qa@1.2.0-negative-splits`
- Cases: **27**
- Scorable now: **24**

## Coverage

| Dimension | Distribution |
|---|---|
| Status | draft: 3; source-verified: 24 |
| Language/domain | C: 3; C#: 1; Haskell: 1; Java: 9; PostgreSQL: 4; Python: 1; React: 6; Ruby: 1; Swift: 1 |
| Difficulty | easy: 8; hard: 13; medium: 6 |
| Answerability | answerable: 15; unanswerable: 12 |
| Negative category | adjacent-technology: 3; out-of-corpus: 5; unsupported-version: 2; vendor-specific: 2 |


## Validation/test split

| Split | Cases | Answerable | Unanswerable | Locked |
|---|---:|---:|---:|---|
| validation | 12 | 6 | 6 | n/a |
| test | 12 | 6 | 6 | yes |

The validation split is used for threshold and configuration selection. The locked test split is used once for the final unbiased estimate.


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
| csharp-linq-iqueryable-001 | source-verified | C# | easy | unanswerable | unanswerable |
| swift-sendable-actors-001 | source-verified | Swift | easy | unanswerable | unanswerable |
| ruby-activerecord-callbacks-001 | source-verified | Ruby | easy | unanswerable | unanswerable |
| haskell-stm-retry-001 | source-verified | Haskell | easy | unanswerable | unanswerable |
| java-android-activity-lifecycle-001 | source-verified | Java | hard | unanswerable | unanswerable |
| react-native-flatlist-001 | source-verified | React | hard | unanswerable | unanswerable |
| python-django-atomic-001 | source-verified | Python | hard | unanswerable | unanswerable |
| postgresql-rds-parameter-groups-001 | source-verified | PostgreSQL | hard | unanswerable | unanswerable |
| c-msvc-sal-annotations-001 | source-verified | C | hard | unanswerable | unanswerable |
| java-se-27-value-classes-001 | source-verified | Java | hard | unanswerable | unanswerable |
| postgresql-19-release-001 | source-verified | PostgreSQL | hard | unanswerable | unanswerable |
| c-array-decay-001 | draft | C | hard | factual | answerable |
| java-overload-resolution-001 | draft | Java | hard | procedural | answerable |
| postgresql-transaction-001 | draft | PostgreSQL | medium | factual | answerable |

Draft cases are candidates only. A model or script may propose them, but they enter scored thesis measurements only after source verification and, for the final benchmark, human approval.
