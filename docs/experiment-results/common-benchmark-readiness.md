# Common benchmark readiness

- Suite: `common-programming-chunk-size-v1`
- Protocol hash: `290c3c632dbcf824101f0e184bf18ffec13d7233e3ed2eefaeb6aa412d2fb280`
- Valid configuration: **yes**
- Baseline: `common-programming-word-850`
- Allowed experimental variable: `chunking.targetWords`

## Controlled experiments

| Experiment | Baseline | Target words | Minimum words | Overlap words | Changed paths | Config hash |
|---|---|---:|---:|---:|---|---|
| common-programming-word-850 | yes | 850 | 200 | 80 | - | dcbd9035 |
| common-programming-word-450 | no | 450 | 200 | 80 | chunking.targetWords | e05f02a6 |
| common-programming-word-300 | no | 300 | 200 | 80 | chunking.targetWords | e053ac36 |

## Metrics

| Metric | Role | Direction | Purpose |
|---|---|---|---|
| ndcgAtK | primary | higher | Rewards relevant evidence appearing early while crediting each expected evidence target once. |
| recallAtK | secondary | higher | Measures how many expected evidence targets are retrieved. |
| precisionAtK | secondary | higher | Measures the share of retrieved chunks matching expected evidence. |
| mrr | secondary | higher | Measures how early the first relevant chunk appears. |
| chunkCount | secondary | context | Records index growth caused by the chunking choice. |
| embeddingLatencyMs | secondary | lower | Tracks the runtime cost of embedding the resulting index. |
| noAnswerFalsePositiveRate | guardrail | lower | Prevents a chunking improvement from hiding worse abstention behavior. |

## Dataset readiness

| Use | Ready | Selected cases | Minimum | Included languages | Missing required languages | Review states |
|---|---|---:|---:|---|---|---|
| Exploratory | yes | 13 | 13 | C, Java, PostgreSQL, React | - | source-verified |
| Thesis | no | 0 | 36 | - | Bash, C, C++, Go, Java, JavaScript, Kotlin, PostgreSQL, Python, React, Rust, TypeScript | human-approved |

## Validation findings

### Errors

- None.

### Warnings

- Golden set: Case c-array-decay-001: draft cases are excluded from scored benchmarks.
- Golden set: Case java-overload-resolution-001: draft cases are excluded from scored benchmarks.
- Golden set: Case postgresql-transaction-001: draft cases are excluded from scored benchmarks.
- Thesis dataset is not ready: 0/36 required cases. Missing languages: Bash, C, C++, Go, Java, JavaScript, Kotlin, PostgreSQL, Python, React, Rust, TypeScript.

The protocol hash covers the suite, experiment definitions, corpus manifests, and golden set. Any change to these inputs creates a different benchmark protocol.
