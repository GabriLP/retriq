# Comparative negative-case verification

- Dataset: `multi-technology-negative-benchmark-v1`
- Frozen corpus hash: `ca6e947cc62f572639ef1261b911d4834a17267c84b2844b0ed3e385c1e48864`
- Validation cases: **8**
- Technology sides covered: **16**
- Exact absence probes: **16**
- Unexpected matches within the corresponding language partitions: **0**
- Locked general test cases touched: **no**

Each case names two technologies that are present in the corpus but asks about a concept outside the scope of their frozen documentation. Absence probes are checked only within those two language partitions because documentation for the unrelated concept may legitimately exist elsewhere in the multi-language corpus.

| Case | Languages | Scope exclusion | Absence probes | Result |
|---|---|---|---|---|
| negative-c-rust-kubernetes-pdb | C + Rust | Kubernetes workload policy resources | `PodDisruptionBudget`; `Kubernetes disruption budget` | no exact match |
| negative-c-cpp-postgresql-isolation | C + C++ | PostgreSQL transaction isolation semantics | `PostgreSQL transaction isolation`; `read committed isolation level` | no exact match |
| negative-java-kotlin-css-grid | Java + Kotlin | Browser CSS Grid layout | `CSS Grid Layout`; `grid track sizing` | no exact match |
| negative-javascript-typescript-borrow-checker | JavaScript + TypeScript | Ownership-based borrow checking | `Rust borrow checker`; `borrow checking rules` | no exact match |
| negative-python-typescript-jvm-verification | Python + TypeScript | JVM class-file verification | `JVM class-file verification`; `class file verifier` | no exact match |
| negative-go-rust-react-effect | Go + Rust | Component Effect lifecycle semantics | `React useEffect`; `Effect cleanup function` | no exact match |
| negative-java-cpp-bash-trap | Java + C++ | Shell trap behavior | `Bash trap handler`; `trap builtin command` | no exact match |
| negative-bash-python-mvcc | Bash + Python | Database MVCC and SQL isolation | `multiversion concurrency control`; `MVCC snapshot isolation` | no exact match |

Exact-string absence is a reproducible sanity check, not semantic proof by itself. The source-manifest scope and the recorded scope basis remain the primary justification for classifying each case as unanswerable.
