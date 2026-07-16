# Human review checklist - benchmark v3

All 60 cases are operationally marked `human-approved`, while `approval.state=pending-confirmation` preserves the fact that independent review is outstanding. Do not execute the locked 18-case test before confirming its cases and freezing the evaluation protocol.

## Coverage note

The 15 answerable cases added when v3 was frozen cover C++, ECMAScript, Kotlin, Bash, and Go. At that time the Python, TypeScript, and Rust acquisitions contained mostly index content, so v3 deliberately made no unsupported positive claims for them. Multipage HTML snapshots have since repaired that corpus limitation; positive cases for these languages belong in a separately versioned benchmark update so the locked v3 test is not silently changed.

| Confirm | Case | Split | Answerability | Language | Evidence or negative basis |
|---|---|---|---|---|---|
| [ ] | `react-state-snapshot-001` | validation | answerable | React | https://react.dev/learn/state-as-a-snapshot (HTML) |
| [ ] | `react-state-queue-001` | validation | answerable | React | https://react.dev/learn/queueing-a-series-of-state-updates (HTML) |
| [ ] | `react-effects-001` | validation | answerable | React | https://react.dev/learn/you-might-not-need-an-effect (HTML); https://react.dev/learn/synchronizing-with-effects (HTML) |
| [ ] | `react-refs-001` | validation | answerable | React | https://react.dev/learn/referencing-values-with-refs (HTML) |
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
| [ ] | `cpp-range-for-lookup-001` | test | answerable | C++ | cpp26-working-draft-n5046 p.206-207 |
| [ ] | `cpp-move-constructor-001` | validation | answerable | C++ | cpp26-working-draft-n5046 p.331-331 |
| [ ] | `cpp-structured-binding-size-001` | validation | answerable | C++ | cpp26-working-draft-n5046 p.280-280 |
| [ ] | `javascript-promise-all-001` | validation | answerable | JavaScript | ecmascript-2026-ecma-262 p.771-773 |
| [ ] | `javascript-promise-any-001` | test | answerable | JavaScript | ecmascript-2026-ecma-262 p.774-775 |
| [ ] | `javascript-array-filter-holes-001` | validation | answerable | JavaScript | ecmascript-2026-ecma-262 p.623-624 |
| [ ] | `kotlin-smart-cast-001` | validation | answerable | Kotlin | kotlin-language-specification p.273-274 |
| [ ] | `kotlin-elvis-lazy-001` | test | answerable | Kotlin | kotlin-language-specification p.186-186 |
| [ ] | `kotlin-not-null-assertion-001` | validation | answerable | Kotlin | kotlin-language-specification p.192-192 |
| [ ] | `bash-pipeline-stderr-001` | validation | answerable | Bash | gnu-bash-5-3-reference-manual p.16-16 |
| [ ] | `bash-pipefail-status-001` | test | answerable | Bash | gnu-bash-5-3-reference-manual p.16-16 |
| [ ] | `bash-heredoc-quoted-delimiter-001` | validation | answerable | Bash | gnu-bash-5-3-reference-manual p.50-50 |
| [ ] | `go-defer-order-001` | test | answerable | Go | go-language-specification (HTML) |
| [ ] | `go-method-set-pointer-001` | test | answerable | Go | go-language-specification (HTML) |
| [ ] | `go-recover-conditions-001` | validation | answerable | Go | go-language-specification (HTML) |
| [ ] | `cpp-qt-signals-001` | test | unanswerable | C++ | The corpus contains the C++ language working draft, not the Qt framework manuals. |
| [ ] | `cpp-cmake-targets-001` | validation | unanswerable | C++ | The corpus contains C++ language documentation, not CMake documentation. |
| [ ] | `javascript-node-fs-001` | test | unanswerable | JavaScript | The corpus contains the ECMAScript language specification, not the Node.js runtime API. |
| [ ] | `javascript-express-router-001` | validation | unanswerable | JavaScript | The corpus contains ECMAScript and React material, not Express framework documentation. |
| [ ] | `kotlin-compose-effects-001` | test | unanswerable | Kotlin | The corpus contains the Kotlin language specification, not Jetpack Compose documentation. |
| [ ] | `kotlin-gradle-plugin-001` | validation | unanswerable | Kotlin | The corpus contains the Kotlin language specification, not Gradle plugin documentation. |
| [ ] | `bash-zsh-completion-001` | validation | unanswerable | Bash | The corpus contains the GNU Bash manual, not Zsh documentation. |
| [ ] | `bash-fish-argparse-001` | validation | unanswerable | Bash | The corpus contains the GNU Bash manual, not Fish shell documentation. |
| [ ] | `python-numpy-broadcast-001` | test | unanswerable | Python | The corpus does not contain NumPy API documentation. |
| [ ] | `python-fastapi-dependencies-001` | validation | unanswerable | Python | The corpus does not contain FastAPI documentation. |
| [ ] | `typescript-angular-onpush-001` | validation | unanswerable | TypeScript | The corpus contains TypeScript handbook material, not Angular documentation. |
| [ ] | `typescript-nestjs-guards-001` | validation | unanswerable | TypeScript | The corpus contains TypeScript handbook material, not NestJS documentation. |
| [ ] | `rust-tokio-tasks-001` | test | unanswerable | Rust | The corpus contains Rust language/book entry pages, not Tokio API documentation. |
| [ ] | `rust-serde-custom-001` | validation | unanswerable | Rust | The corpus does not contain Serde documentation. |
| [ ] | `go-client-kubernetes-001` | test | unanswerable | Go | The corpus contains the Go language specification, not Kubernetes client-go documentation. |
