# Frozen generation benchmark v1

- Benchmark: `retriq-generation-benchmark-v1`
- Frozen from retrieval attempt: 2026-07-17T09:33:22.581Z
- Cases: 54 (27 answerable + 27 unanswerable)
- Generator invocations: 27; deterministic abstentions: 27
- Frozen evidence references: 104
- Languages represented: Bash, C, C#, C++, Go, Haskell, Java, JavaScript, Kotlin, PostgreSQL, Python, React, Ruby, Rust, Swift, TypeScript
- Human calibration subset: 24 cases
- Locked test touched: **no**

The tracked benchmark stores chunk identifiers, retrieval order, source metadata, and content hashes rather than duplicating source text. Generation scripts must reconstruct each excerpt from the frozen parent run and reject any hash mismatch. The calibration subset was selected before generator outputs existed.
