# Metadata-aware retrieval comparison

- Protocol/attempt: `baseline-gemini-300-v2-metadata-filter-v1` / `20260716175240907`
- Parent run: `20260716175046643-70de10e9`
- Split: **validation only**
- Hypothesis: The deterministic technology/version compatibility gate resolves score overlap introduced by hard negatives while preserving perfect answerable retrieval quality.
- Changed variable: Deterministic query-to-corpus technology/version compatibility gate
- Cache-only: **yes**
- Metadata coverage: 30455/30455 chunks with language, 29667/30455 with version

| Variant | Selected threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR | Decision |
|---|---:|---:|---:|---:|---:|---:|---|
| dense-cosine | n/a | n/a | n/a | n/a | n/a | n/a | No threshold satisfied the guardrails. |
| metadata-aware-dense | 0.65 | 1.0000 | 0.7292 | 1.0000 | 1.0000 | 0.0000 | Selected by the predeclared validation rule. |

## Compatibility decisions

| Case | Answerability | Decision | Technology | Version | Compatible chunks |
|---|---|---|---|---:|---:|
| react-state-snapshot-001 | answerable | compatible | - | - | 30455 |
| react-state-queue-001 | answerable | compatible | - | - | 30455 |
| react-effects-001 | answerable | compatible | - | - | 30455 |
| react-refs-001 | answerable | compatible | - | - | 30455 |
| react-out-of-scope-001 | unanswerable | unsupported-technology | angular | - | 0 |
| c-standard-purpose-001 | answerable | compatible | c | 11 | 2832 |
| java-spec-release-001 | answerable | compatible | java | - | 2448 |
| java-ods-arraystack-amortized-001 | answerable | compatible | - | - | 30455 |
| java-ods-dual-array-deque-001 | answerable | compatible | - | - | 30455 |
| java-ods-skiplist-analysis-001 | answerable | compatible | - | - | 30455 |
| java-ods-linear-probing-001 | answerable | compatible | - | - | 30455 |
| java-ods-red-black-tree-001 | answerable | compatible | - | - | 30455 |
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

The compatibility gate is deterministic and uses manifest-derived metadata. It does not inspect expected answers or evidence. This validation result must not be reported as a new held-out test result; the previous test split has already been observed.
