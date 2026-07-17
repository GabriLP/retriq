# Metadata-aware retrieval comparison

- Protocol/attempt: `baseline-gemini-300-v4-metadata-filter-v1` / `20260717085403701`
- Parent run: `20260717084956473-e60c88ec`
- Split: **validation only**
- Hypothesis: The deterministic technology/version compatibility gate keeps the no-answer false-positive rate at zero on the expanded benchmark without materially degrading page-specific answerable retrieval.
- Changed variable: Deterministic query-to-corpus technology/version compatibility gate
- Cache-only: **yes**
- Metadata coverage: 33079/33079 chunks with language, 32291/33079 with version

| Variant | Selected threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR | Decision |
|---|---:|---:|---:|---:|---:|---:|---|
| dense-cosine | n/a | n/a | n/a | n/a | n/a | n/a | No threshold satisfied the guardrails. |
| metadata-aware-dense | n/a | n/a | n/a | n/a | n/a | n/a | No threshold satisfied the guardrails. |

## Compatibility decisions

| Case | Answerability | Decision | Technology | Version | Compatible chunks |
|---|---|---|---|---:|---:|
| react-state-snapshot-001 | answerable | compatible | - | - | 33079 |
| react-state-queue-001 | answerable | compatible | - | - | 33079 |
| react-effects-001 | answerable | compatible | - | - | 33079 |
| react-refs-001 | answerable | compatible | - | - | 33079 |
| react-out-of-scope-001 | unanswerable | unsupported-technology | angular | - | 0 |
| c-standard-purpose-001 | answerable | compatible | c | 11 | 2832 |
| java-spec-release-001 | answerable | compatible | java | - | 2448 |
| java-ods-arraystack-amortized-001 | answerable | compatible | - | - | 33079 |
| java-ods-dual-array-deque-001 | answerable | compatible | - | - | 33079 |
| java-ods-skiplist-analysis-001 | answerable | compatible | - | - | 33079 |
| java-ods-linear-probing-001 | answerable | compatible | - | - | 33079 |
| java-ods-red-black-tree-001 | answerable | compatible | - | - | 33079 |
| postgresql-license-001 | answerable | compatible | postgresql | 18 | 7758 |
| csharp-linq-iqueryable-001 | unanswerable | unsupported-technology | csharp | - | 0 |
| swift-sendable-actors-001 | unanswerable | unsupported-technology | swift | - | 0 |
| ruby-activerecord-callbacks-001 | unanswerable | unsupported-technology | ruby | - | 0 |
| haskell-stm-retry-001 | unanswerable | unsupported-technology | haskell | - | 0 |
| java-android-activity-lifecycle-001 | unanswerable | unsupported-technology | android | - | 0 |
| react-native-flatlist-001 | unanswerable | unsupported-technology | react-native | - | 0 |
| python-django-atomic-001 | unanswerable | unsupported-technology | django | - | 0 |
| postgresql-rds-parameter-groups-001 | unanswerable | unsupported-technology | aws-rds | - | 0 |
| c-msvc-sal-annotations-001 | unanswerable | compatible | c | - | 9222 |
| java-se-27-value-classes-001 | unanswerable | unsupported-version | java | 27 | 0 |
| postgresql-19-release-001 | unanswerable | unsupported-version | postgresql | 19 | 0 |
| cpp-move-constructor-001 | answerable | compatible | c | - | 9222 |
| cpp-structured-binding-size-001 | answerable | compatible | c | - | 9222 |
| javascript-promise-all-001 | answerable | compatible | - | - | 33079 |
| javascript-array-filter-holes-001 | answerable | compatible | - | - | 33079 |
| kotlin-smart-cast-001 | answerable | compatible | kotlin | - | 500 |
| kotlin-not-null-assertion-001 | answerable | compatible | kotlin | - | 500 |
| bash-pipeline-stderr-001 | answerable | compatible | bash | - | 688 |
| bash-heredoc-quoted-delimiter-001 | answerable | compatible | bash | - | 688 |
| go-recover-conditions-001 | answerable | compatible | - | - | 33079 |
| cpp-cmake-targets-001 | unanswerable | compatible | - | - | 33079 |
| javascript-express-router-001 | unanswerable | compatible | - | - | 33079 |
| kotlin-gradle-plugin-001 | unanswerable | compatible | kotlin | - | 500 |
| bash-zsh-completion-001 | unanswerable | compatible | - | - | 33079 |
| bash-fish-argparse-001 | unanswerable | compatible | - | - | 33079 |
| python-fastapi-dependencies-001 | unanswerable | compatible | - | - | 33079 |
| typescript-angular-onpush-001 | unanswerable | unsupported-technology | angular | - | 0 |
| typescript-nestjs-guards-001 | unanswerable | compatible | - | - | 33079 |
| rust-serde-custom-001 | unanswerable | compatible | - | - | 33079 |
| python-list-comprehension-001 | answerable | compatible | python | - | 510 |
| python-parameter-kinds-001 | answerable | compatible | python | - | 510 |
| typescript-conditional-distribution-001 | answerable | compatible | typescript | - | 607 |
| typescript-keyof-001 | answerable | compatible | typescript | - | 607 |
| rust-ownership-move-clone-001 | answerable | compatible | rust | - | 1549 |
| rust-mutable-reference-rules-001 | answerable | compatible | rust | - | 1549 |
| python-pandas-groupby-001 | unanswerable | compatible | - | - | 33079 |
| python-celery-retry-001 | unanswerable | compatible | - | - | 33079 |
| typescript-vite-glob-001 | unanswerable | compatible | - | - | 33079 |
| typescript-prisma-transaction-001 | unanswerable | compatible | - | - | 33079 |
| rust-bevy-query-001 | unanswerable | compatible | - | - | 33079 |
| rust-diesel-querydsl-001 | unanswerable | compatible | - | - | 33079 |

The compatibility gate is deterministic and uses manifest-derived metadata. It does not inspect expected answers or evidence. This validation result must not be reported as a new held-out test result; the previous test split has already been observed.
