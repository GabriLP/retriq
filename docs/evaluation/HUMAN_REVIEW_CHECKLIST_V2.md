# Human review checklist - benchmark v2

Every case is operationally marked `human-approved` with `approval.state=pending-confirmation`. Check the source/evidence and change the state to `confirmed` only after independent review. The fresh test split must not be executed until its six cases are confirmed and the selection rule is frozen.

| Confirm | Case | Split | Answerability | Language | Evidence or negative basis |
|---|---|---|---|---|---|
| [ ] | `react-state-snapshot-001` | validation | answerable | React | https://react.dev/learn/state-as-a-snapshot p.web-web |
| [ ] | `react-state-queue-001` | validation | answerable | React | https://react.dev/learn/queueing-a-series-of-state-updates p.web-web |
| [ ] | `react-effects-001` | validation | answerable | React | https://react.dev/learn/you-might-not-need-an-effect p.web-web; https://react.dev/learn/synchronizing-with-effects p.web-web |
| [ ] | `react-refs-001` | validation | answerable | React | https://react.dev/learn/referencing-values-with-refs p.web-web |
| [ ] | `react-out-of-scope-001` | validation | unanswerable | React | Neither corpus manifest includes Angular documentation; incidental module terminology is not Angular API coverage. |
| [ ] | `c-standard-purpose-001` | validation | answerable | C | c11-working-draft-n1570 p.1-1 |
| [ ] | `java-spec-release-001` | validation | answerable | Java | java-se-26-language-specification p.1-2 |
| [ ] | `java-ods-arraystack-amortized-001` | validation | answerable | Java | open-data-structures-java p.30-31 |
| [ ] | `java-ods-dual-array-deque-001` | validation | answerable | Java | open-data-structures-java p.42-44 |
| [ ] | `java-ods-skiplist-analysis-001` | validation | answerable | Java | open-data-structures-java p.83-86 |
| [ ] | `java-ods-linear-probing-001` | validation | answerable | Java | open-data-structures-java p.98-100 |
| [ ] | `java-ods-red-black-tree-001` | validation | answerable | Java | open-data-structures-java p.156-159 |
| [ ] | `postgresql-license-001` | validation | answerable | PostgreSQL | postgresql-18-manual p.2-2 |
| [ ] | `csharp-linq-iqueryable-001` | validation | unanswerable | C# | C# and .NET are absent from both corpus manifests. |
| [ ] | `swift-sendable-actors-001` | validation | unanswerable | Swift | Swift is absent from both corpus manifests. |
| [ ] | `ruby-activerecord-callbacks-001` | validation | unanswerable | Ruby | Ruby and Rails are absent from both corpus manifests. |
| [ ] | `haskell-stm-retry-001` | validation | unanswerable | Haskell | Haskell is absent from both corpus manifests. |
| [ ] | `java-android-activity-lifecycle-001` | validation | unanswerable | Java | The Java sources cover the language and data structures, not Android APIs. |
| [ ] | `react-native-flatlist-001` | validation | unanswerable | React | React Native is not a source in either manifest. |
| [ ] | `python-django-atomic-001` | validation | unanswerable | Python | Django is not a source in either manifest; an incidental Vite integration mention is not API coverage. |
| [ ] | `postgresql-rds-parameter-groups-001` | validation | unanswerable | PostgreSQL | AWS RDS documentation is absent from both manifests. |
| [ ] | `c-msvc-sal-annotations-001` | validation | unanswerable | C | Microsoft MSVC and SAL documentation are absent from both manifests. |
| [ ] | `java-se-27-value-classes-001` | validation | unanswerable | Java | The Java source snapshot predates a final Java SE 27 specification. |
| [ ] | `postgresql-19-release-001` | validation | unanswerable | PostgreSQL | The manifest pins postgresql-18-manual, so PostgreSQL 19 release notes are outside the snapshot. |
| [ ] | `c-array-decay-001` | test | answerable | C | c11-working-draft-n1570 p.72-73 |
| [ ] | `java-overload-resolution-001` | test | answerable | Java | java-se-26-language-specification p.656-658 |
| [ ] | `postgresql-transaction-001` | test | answerable | PostgreSQL | postgresql-18-manual p.57-58 |
| [ ] | `c-cuda-unified-memory-001` | test | unanswerable | C | The corpus contains C and system-library documentation, not the NVIDIA CUDA Runtime API documentation. |
| [ ] | `java-hibernate-lazyinit-001` | test | unanswerable | Java | The corpus contains the Java language specification and Java data-structure material, not Hibernate ORM documentation. |
| [ ] | `postgresql-pg-partman-retention-001` | test | unanswerable | PostgreSQL | The corpus contains the upstream PostgreSQL manual, not the pg_partman extension documentation. |
