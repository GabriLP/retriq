# Golden set summary

- Dataset: `retriq-programming-qa@4.0.0-html-language-coverage`
- Cases: **78**
- Operationally scorable: **78**
- Independently confirmed human approvals: **0**

## Coverage

| Dimension | Distribution |
|---|---|
| Status | human-approved: 78 |
| Language/domain | Bash: 5; C: 4; C#: 1; C++: 5; Go: 4; Haskell: 1; Java: 10; JavaScript: 5; Kotlin: 5; PostgreSQL: 5; Python: 9; React: 6; Ruby: 1; Rust: 8; Swift: 1; TypeScript: 8 |
| Difficulty | easy: 8; hard: 43; medium: 27 |
| Answerability | answerable: 39; unanswerable: 39 |
| Approval state | pending-confirmation: 78 |
| Negative category | adjacent-technology: 30; out-of-corpus: 5; unsupported-version: 2; vendor-specific: 2 |


## Validation/test split

| Split | Cases | Answerable | Unanswerable | Locked |
|---|---:|---:|---:|---|
| validation | 54 | 27 | 27 | n/a |
| test | 24 | 12 | 12 | yes |

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
| cpp-range-for-lookup-001 | human-approved | C++ | hard | multi-hop | answerable |
| cpp-move-constructor-001 | human-approved | C++ | medium | factual | answerable |
| cpp-structured-binding-size-001 | human-approved | C++ | medium | factual | answerable |
| javascript-promise-all-001 | human-approved | JavaScript | medium | comparative | answerable |
| javascript-promise-any-001 | human-approved | JavaScript | medium | factual | answerable |
| javascript-array-filter-holes-001 | human-approved | JavaScript | medium | factual | answerable |
| kotlin-smart-cast-001 | human-approved | Kotlin | medium | factual | answerable |
| kotlin-elvis-lazy-001 | human-approved | Kotlin | medium | factual | answerable |
| kotlin-not-null-assertion-001 | human-approved | Kotlin | medium | factual | answerable |
| bash-pipeline-stderr-001 | human-approved | Bash | medium | factual | answerable |
| bash-pipefail-status-001 | human-approved | Bash | medium | comparative | answerable |
| bash-heredoc-quoted-delimiter-001 | human-approved | Bash | medium | factual | answerable |
| go-defer-order-001 | human-approved | Go | medium | multi-hop | answerable |
| go-method-set-pointer-001 | human-approved | Go | medium | comparative | answerable |
| go-recover-conditions-001 | human-approved | Go | hard | multi-hop | answerable |
| cpp-qt-signals-001 | human-approved | C++ | hard | unanswerable | unanswerable |
| cpp-cmake-targets-001 | human-approved | C++ | hard | unanswerable | unanswerable |
| javascript-node-fs-001 | human-approved | JavaScript | hard | unanswerable | unanswerable |
| javascript-express-router-001 | human-approved | JavaScript | hard | unanswerable | unanswerable |
| kotlin-compose-effects-001 | human-approved | Kotlin | hard | unanswerable | unanswerable |
| kotlin-gradle-plugin-001 | human-approved | Kotlin | hard | unanswerable | unanswerable |
| bash-zsh-completion-001 | human-approved | Bash | hard | unanswerable | unanswerable |
| bash-fish-argparse-001 | human-approved | Bash | hard | unanswerable | unanswerable |
| python-numpy-broadcast-001 | human-approved | Python | hard | unanswerable | unanswerable |
| python-fastapi-dependencies-001 | human-approved | Python | hard | unanswerable | unanswerable |
| typescript-angular-onpush-001 | human-approved | TypeScript | hard | unanswerable | unanswerable |
| typescript-nestjs-guards-001 | human-approved | TypeScript | hard | unanswerable | unanswerable |
| rust-tokio-tasks-001 | human-approved | Rust | hard | unanswerable | unanswerable |
| rust-serde-custom-001 | human-approved | Rust | hard | unanswerable | unanswerable |
| go-client-kubernetes-001 | human-approved | Go | hard | unanswerable | unanswerable |
| python-list-comprehension-001 | human-approved | Python | medium | factual | answerable |
| python-default-argument-once-001 | human-approved | Python | medium | factual | answerable |
| python-parameter-kinds-001 | human-approved | Python | medium | factual | answerable |
| typescript-discriminated-union-001 | human-approved | TypeScript | medium | factual | answerable |
| typescript-conditional-distribution-001 | human-approved | TypeScript | hard | comparative | answerable |
| typescript-keyof-001 | human-approved | TypeScript | medium | factual | answerable |
| rust-ownership-move-clone-001 | human-approved | Rust | medium | comparative | answerable |
| rust-mutable-reference-rules-001 | human-approved | Rust | medium | factual | answerable |
| rust-question-mark-result-001 | human-approved | Rust | medium | factual | answerable |
| python-pandas-groupby-001 | human-approved | Python | hard | unanswerable | unanswerable |
| python-sqlalchemy-async-001 | human-approved | Python | hard | unanswerable | unanswerable |
| python-celery-retry-001 | human-approved | Python | hard | unanswerable | unanswerable |
| typescript-deno-permissions-001 | human-approved | TypeScript | hard | unanswerable | unanswerable |
| typescript-vite-glob-001 | human-approved | TypeScript | hard | unanswerable | unanswerable |
| typescript-prisma-transaction-001 | human-approved | TypeScript | hard | unanswerable | unanswerable |
| rust-axum-state-001 | human-approved | Rust | hard | unanswerable | unanswerable |
| rust-bevy-query-001 | human-approved | Rust | hard | unanswerable | unanswerable |
| rust-diesel-querydsl-001 | human-approved | Rust | hard | unanswerable | unanswerable |

Draft cases are candidates only. Provisional approvals may be used for engineering runs, but final thesis measurements require `approval.state=confirmed` after independent review.
