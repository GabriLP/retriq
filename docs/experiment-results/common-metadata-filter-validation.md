# Metadata-aware retrieval comparison

- Protocol/attempt: `common-metadata-filter-v1` / `20260716131927320`
- Parent run: `20260716131853455-aad7c6f9`
- Split: **validation only**
- Hypothesis: A deterministic compatibility gate will reduce out-of-scope and unsupported-version retrieval while preserving answerable Recall@4 and MRR.
- Changed variable: Deterministic query-to-corpus technology/version compatibility gate
- Cache-only: **yes**
- Metadata coverage: 30455/30455 chunks with language, 29667/30455 with version

| Variant | Selected threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR | Decision |
|---|---:|---:|---:|---:|---:|---:|---|
| dense-cosine | 0.75 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 0.0000 | Selected by the predeclared validation rule. |
| metadata-aware-dense | 0.18 | 1.0000 | 0.6667 | 1.0000 | 1.0000 | 0.0000 | Selected by the predeclared validation rule. |

## Compatibility decisions

| Case | Answerability | Decision | Technology | Version | Compatible chunks |
|---|---|---|---|---:|---:|
| react-state-snapshot-001 | answerable | compatible | - | - | 30455 |
| react-effects-001 | answerable | compatible | - | - | 30455 |
| react-out-of-scope-001 | unanswerable | unsupported-technology | angular | - | 0 |
| c-standard-purpose-001 | answerable | compatible | c | 11 | 2832 |
| java-spec-release-001 | answerable | compatible | java | - | 2448 |
| java-ods-arraystack-amortized-001 | answerable | compatible | - | - | 30455 |
| java-ods-skiplist-analysis-001 | answerable | compatible | - | - | 30455 |
| swift-sendable-actors-001 | unanswerable | unsupported-technology | swift | - | 0 |
| haskell-stm-retry-001 | unanswerable | unsupported-technology | haskell | - | 0 |
| react-native-flatlist-001 | unanswerable | unsupported-technology | react-native | - | 0 |
| postgresql-rds-parameter-groups-001 | unanswerable | unsupported-technology | aws-rds | - | 0 |
| java-se-27-value-classes-001 | unanswerable | unsupported-version | java | 27 | 0 |

The compatibility gate is deterministic and uses manifest-derived metadata. It does not inspect expected answers or evidence. This validation result must not be reported as a new held-out test result; the previous test split has already been observed.
