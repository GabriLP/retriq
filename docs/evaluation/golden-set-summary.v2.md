# Golden set summary

- Dataset: `retriq-programming-qa@2.0.0-provisional-human-review`
- Cases: **30**
- Operationally scorable: **30**
- Independently confirmed human approvals: **0**

## Coverage

| Dimension | Distribution |
|---|---|
| Status | human-approved: 30 |
| Language/domain | C: 4; C#: 1; Haskell: 1; Java: 10; PostgreSQL: 5; Python: 1; React: 6; Ruby: 1; Swift: 1 |
| Difficulty | easy: 8; hard: 16; medium: 6 |
| Answerability | answerable: 15; unanswerable: 15 |
| Approval state | pending-confirmation: 30 |
| Negative category | adjacent-technology: 6; out-of-corpus: 5; unsupported-version: 2; vendor-specific: 2 |


## Validation/test split

| Split | Cases | Answerable | Unanswerable | Locked |
|---|---:|---:|---:|---|
| validation | 24 | 12 | 12 | n/a |
| test | 6 | 3 | 3 | yes |

The validation split is used for threshold and configuration selection. The locked test split is used once for the final unbiased estimate.


## Case inventory

| Case | Status | Language | Difficulty | Type | Answerability |
|---|---|---|---|---|---|
| react-state-snapshot-001 | human-approved | React | medium | factual | answerable |
| react-state-queue-001 | human-approved | React | medium | procedural | answerable |
| react-effects-001 | human-approved | React | medium | comparative | answerable |
| react-refs-001 | human-approved | React | easy | factual | answerable |
| react-out-of-scope-001 | human-approved | React | easy | unanswerable | unanswerable |
| c-standard-purpose-001 | human-approved | C | easy | factual | answerable |
| java-spec-release-001 | human-approved | Java | easy | factual | answerable |
| java-ods-arraystack-amortized-001 | human-approved | Java | hard | multi-hop | answerable |
| java-ods-dual-array-deque-001 | human-approved | Java | hard | multi-hop | answerable |
| java-ods-skiplist-analysis-001 | human-approved | Java | medium | factual | answerable |
| java-ods-linear-probing-001 | human-approved | Java | hard | factual | answerable |
| java-ods-red-black-tree-001 | human-approved | Java | hard | multi-hop | answerable |
| postgresql-license-001 | human-approved | PostgreSQL | medium | factual | answerable |
| csharp-linq-iqueryable-001 | human-approved | C# | easy | unanswerable | unanswerable |
| swift-sendable-actors-001 | human-approved | Swift | easy | unanswerable | unanswerable |
| ruby-activerecord-callbacks-001 | human-approved | Ruby | easy | unanswerable | unanswerable |
| haskell-stm-retry-001 | human-approved | Haskell | easy | unanswerable | unanswerable |
| java-android-activity-lifecycle-001 | human-approved | Java | hard | unanswerable | unanswerable |
| react-native-flatlist-001 | human-approved | React | hard | unanswerable | unanswerable |
| python-django-atomic-001 | human-approved | Python | hard | unanswerable | unanswerable |
| postgresql-rds-parameter-groups-001 | human-approved | PostgreSQL | hard | unanswerable | unanswerable |
| c-msvc-sal-annotations-001 | human-approved | C | hard | unanswerable | unanswerable |
| java-se-27-value-classes-001 | human-approved | Java | hard | unanswerable | unanswerable |
| postgresql-19-release-001 | human-approved | PostgreSQL | hard | unanswerable | unanswerable |
| c-array-decay-001 | human-approved | C | hard | factual | answerable |
| java-overload-resolution-001 | human-approved | Java | hard | procedural | answerable |
| postgresql-transaction-001 | human-approved | PostgreSQL | medium | factual | answerable |
| c-cuda-unified-memory-001 | human-approved | C | hard | unanswerable | unanswerable |
| java-hibernate-lazyinit-001 | human-approved | Java | hard | unanswerable | unanswerable |
| postgresql-pg-partman-retention-001 | human-approved | PostgreSQL | hard | unanswerable | unanswerable |

Draft cases are candidates only. Provisional approvals may be used for engineering runs, but final thesis measurements require `approval.state=confirmed` after independent review.
