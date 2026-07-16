# Human review checklist - benchmark v4

The v4 benchmark adds positive Python, TypeScript, and Rust cases after multipage HTML acquisition. All v3 assignments are preserved. The 24-case test remains locked and must not be executed before independent confirmation and protocol freeze.

| Confirm | Case | Split | Answerability | Language | Evidence or negative basis |
|---|---|---|---|---|---|
| [ ] | `react-state-snapshot-001` | validation | answerable | React | https://react.dev/learn/state-as-a-snapshot: State as a Snapshot |
| [ ] | `react-state-queue-001` | validation | answerable | React | https://react.dev/learn/queueing-a-series-of-state-updates: Updating the same state multiple times before the next render |
| [ ] | `react-effects-001` | validation | answerable | React | https://react.dev/learn/you-might-not-need-an-effect: How to remove unnecessary Effects; https://react.dev/learn/synchronizing-with-effects: What are Effects and how are they different from events? |
| [ ] | `react-refs-001` | validation | answerable | React | https://react.dev/learn/referencing-values-with-refs: Differences between refs and state |
| [ ] | `react-out-of-scope-001` | validation | unanswerable | React | Neither corpus manifest includes Angular documentation; incidental module terminology is not Angular API coverage. |
| [ ] | `c-standard-purpose-001` | validation | answerable | C | c11-working-draft-n1570: Abstract |
| [ ] | `java-spec-release-001` | validation | answerable | Java | java-se-26-language-specification: Java SE 26 Edition |
| [ ] | `java-ods-arraystack-amortized-001` | validation | answerable | Java | open-data-structures-java: 2.1.2 Growing and Shrinking |
| [ ] | `java-ods-dual-array-deque-001` | validation | answerable | Java | open-data-structures-java: 2.5.1 Balancing |
| [ ] | `java-ods-skiplist-analysis-001` | validation | answerable | Java | open-data-structures-java: 4.4 Analysis of Skiplists |
| [ ] | `java-ods-linear-probing-001` | validation | answerable | Java | open-data-structures-java: 5.2.1 Analysis of Linear Probing |
| [ ] | `java-ods-red-black-tree-001` | validation | answerable | Java | open-data-structures-java: 9.2.1 Red-Black Trees and 2-4 Trees |
| [ ] | `postgresql-license-001` | validation | answerable | PostgreSQL | postgresql-18-manual: Legal Notice |
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
| [ ] | `c-array-decay-001` | test | answerable | C | c11-working-draft-n1570: 6.3.2.1 Lvalues, arrays, and function designators |
| [ ] | `java-overload-resolution-001` | test | answerable | Java | java-se-26-language-specification: 15.12.2.2-15.12.2.4 Applicability phases |
| [ ] | `postgresql-transaction-001` | test | answerable | PostgreSQL | postgresql-18-manual: 3.4 Transactions |
| [ ] | `c-cuda-unified-memory-001` | test | unanswerable | C | The corpus contains C and system-library documentation, not the NVIDIA CUDA Runtime API documentation. |
| [ ] | `java-hibernate-lazyinit-001` | test | unanswerable | Java | The corpus contains the Java language specification and Java data-structure material, not Hibernate ORM documentation. |
| [ ] | `postgresql-pg-partman-retention-001` | test | unanswerable | PostgreSQL | The corpus contains the upstream PostgreSQL manual, not the pg_partman extension documentation. |
| [ ] | `cpp-range-for-lookup-001` | test | answerable | C++ | cpp26-working-draft-n5046: 8.6.5 The range-based for statement |
| [ ] | `cpp-move-constructor-001` | validation | answerable | C++ | cpp26-working-draft-n5046: 11.4.5.3 Copy/move constructors |
| [ ] | `cpp-structured-binding-size-001` | validation | answerable | C++ | cpp26-working-draft-n5046: 9.7 Structured binding declarations |
| [ ] | `javascript-promise-all-001` | validation | answerable | JavaScript | ecmascript-2026-ecma-262: 27.2.4.1-27.2.4.2 Promise combinators |
| [ ] | `javascript-promise-any-001` | test | answerable | JavaScript | ecmascript-2026-ecma-262: 27.2.4.3 Promise.any |
| [ ] | `javascript-array-filter-holes-001` | validation | answerable | JavaScript | ecmascript-2026-ecma-262: 23.1.3.8 Array.prototype.filter |
| [ ] | `kotlin-smart-cast-001` | validation | answerable | Kotlin | kotlin-language-specification: 14.1 Smart casts |
| [ ] | `kotlin-elvis-lazy-001` | test | answerable | Kotlin | kotlin-language-specification: 8.12 Elvis operator expressions |
| [ ] | `kotlin-not-null-assertion-001` | validation | answerable | Kotlin | kotlin-language-specification: 8.19 Not-null assertion expressions |
| [ ] | `bash-pipeline-stderr-001` | validation | answerable | Bash | gnu-bash-5-3-reference-manual: 3.2.3 Pipelines |
| [ ] | `bash-pipefail-status-001` | test | answerable | Bash | gnu-bash-5-3-reference-manual: 3.2.3 Pipelines |
| [ ] | `bash-heredoc-quoted-delimiter-001` | validation | answerable | Bash | gnu-bash-5-3-reference-manual: 3.6.6 Here Documents |
| [ ] | `go-defer-order-001` | test | answerable | Go | go-language-specification: Defer statements |
| [ ] | `go-method-set-pointer-001` | test | answerable | Go | go-language-specification: Method sets |
| [ ] | `go-recover-conditions-001` | validation | answerable | Go | go-language-specification: Handling panics |
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
| [ ] | `python-list-comprehension-001` | validation | answerable | Python | python-tutorial: 5.1.3 List Comprehensions |
| [ ] | `python-default-argument-once-001` | test | answerable | Python | python-tutorial: 4.9.1 Default Argument Values |
| [ ] | `python-parameter-kinds-001` | validation | answerable | Python | python-language-reference: Function definitions and parameter lists |
| [ ] | `typescript-discriminated-union-001` | test | answerable | TypeScript | typescript-handbook: Discriminated unions |
| [ ] | `typescript-conditional-distribution-001` | validation | answerable | TypeScript | typescript-handbook: Distributive Conditional Types |
| [ ] | `typescript-keyof-001` | validation | answerable | TypeScript | typescript-handbook: The keyof type operator |
| [ ] | `rust-ownership-move-clone-001` | validation | answerable | Rust | rust-book: Variables and Data Interacting with Move and Clone |
| [ ] | `rust-mutable-reference-rules-001` | validation | answerable | Rust | rust-book: Mutable References |
| [ ] | `rust-question-mark-result-001` | test | answerable | Rust | rust-book: The ? Operator Shortcut |
| [ ] | `python-pandas-groupby-001` | validation | unanswerable | Python | The corpus contains Python language documentation, not the pandas API. |
| [ ] | `python-sqlalchemy-async-001` | test | unanswerable | Python | The corpus contains Python language documentation, not SQLAlchemy documentation. |
| [ ] | `python-celery-retry-001` | validation | unanswerable | Python | The corpus contains Python language documentation, not Celery documentation. |
| [ ] | `typescript-deno-permissions-001` | test | unanswerable | TypeScript | The corpus contains TypeScript language documentation, not Deno runtime documentation. |
| [ ] | `typescript-vite-glob-001` | validation | unanswerable | TypeScript | The corpus contains TypeScript language documentation, not Vite documentation. |
| [ ] | `typescript-prisma-transaction-001` | validation | unanswerable | TypeScript | The corpus contains TypeScript language documentation, not Prisma ORM documentation. |
| [ ] | `rust-axum-state-001` | test | unanswerable | Rust | The corpus contains Rust language documentation, not the Axum framework API. |
| [ ] | `rust-bevy-query-001` | validation | unanswerable | Rust | The corpus contains Rust language documentation, not the Bevy engine API. |
| [ ] | `rust-diesel-querydsl-001` | validation | unanswerable | Rust | The corpus contains Rust language documentation, not Diesel ORM documentation. |
