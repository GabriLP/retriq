# Comparative-query retrieval benchmark

- Protocol/attempt: `multi-technology-retrieval-v1` / `20260721090851613`
- Parent run: `20260717084956473-e60c88ec`
- Split: **validation only**; locked test touched: **no**
- Hypothesis: A union metadata filter avoids dropping one named technology, while balanced multi-technology ordering increases two-sided coverage within topK=4 without reducing canonical evidence coverage.
- Evaluation commit: `883182f98c5c6aff3bfe79a566b0ebdea0ef7639`
- Fixed retrieval: Gemini Embedding 2 (1,024d), cosine >= 0.68, topK=4, no reranker
- This replay: **0** provider input(s) in **0** request(s), estimated incremental cost **$0.00000000**
- Original provider execution: `20260721090504704`, **8** input(s) in **1** request(s), estimated cost **$0.00004080**
- Cosine scoring time: **271 ms**

| Variant | Both languages @4 | Mean language-side coverage | Both canonical evidence sides @4 | Mean evidence-side recall | Macro side MRR | Returned chunks |
|---|---:|---:|---:|---:|---:|---:|
| legacy-first-technology | 0.0000 | 0.3750 | 0.0000 | 0.2500 | 0.2188 | 18 |
| multi-technology-unbalanced | 0.3750 | 0.6875 | 0.2500 | 0.5625 | 0.3802 | 31 |
| multi-technology-balanced | 0.6250 | 0.8125 | 0.2500 | 0.5000 | 0.3646 | 31 |

## Decision

**multi-technology-balanced.** Selected by the preregistered validation rule.

## Per-case audit

### legacy-first-technology

| Case | Languages represented | Canonical evidence represented | Retrieved chunks |
|---|---|---|---|
| compare-c-rust-heap-memory | Rust | Rust | 1:Rust/8238e2e53432bd18@0.7510; 2:Rust/d2e6b82c3bebee4c@0.7347; 3:Rust/ead1311e43db94c9@0.7338; 4:Rust/d715b69606a84bb9@0.7271 |
| compare-c-cpp-dynamic-deallocation | C++ | none | 1:C++/402a75a061d344c4@0.6822 |
| compare-java-kotlin-nullability | none | none | none |
| compare-javascript-typescript-type-errors | TypeScript | TypeScript | 1:TypeScript/7c4ccaa942e40446@0.7668; 2:TypeScript/1ac6ec3e98653e9b@0.7580; 3:TypeScript/852dee0342e422e3@0.7539; 4:TypeScript/35a6a9c0a60b152d@0.7486 |
| compare-python-typescript-type-annotations | none | none | none |
| compare-go-rust-panic-recovery | Rust | Rust | 1:Rust/0b279a517bd3b054@0.7503; 2:Rust/b1776b1f7794289b@0.7423; 3:Rust/016d288441967425@0.7383; 4:Rust/703f3f7be9d3be9d@0.7339 |
| compare-java-cpp-multiple-inheritance | Java | none | 1:Java/4ff89fdf16fab7a1@0.7297; 2:Java/8998e0a810bb2795@0.6977; 3:Java/5b4973de984a447b@0.6919; 4:Java/c5bcd42e469d91c9@0.6904 |
| compare-bash-python-for-loops | Python | Python | 1:Python/98e19280456ce52e@0.6952 |

### multi-technology-unbalanced

| Case | Languages represented | Canonical evidence represented | Retrieved chunks |
|---|---|---|---|
| compare-c-rust-heap-memory | Rust | Rust | 1:Rust/8238e2e53432bd18@0.7510; 2:Rust/d2e6b82c3bebee4c@0.7347; 3:Rust/ead1311e43db94c9@0.7338; 4:Rust/d715b69606a84bb9@0.7271 |
| compare-c-cpp-dynamic-deallocation | C | C | 1:C/ebd5f7d6ce28eec3@0.7248; 2:C/885d375ea9a7664d@0.7217; 3:C/a7578e6ebf8efe8f@0.7010; 4:C/8d797f1058a89db7@0.6924 |
| compare-java-kotlin-nullability | Kotlin | Kotlin | 1:Kotlin/de8e8d15fe992755@0.7295; 2:Kotlin/7be1556b0f36dcd8@0.7157; 3:Kotlin/7a10d737e9d75bdf@0.7116; 4:Kotlin/30450b4bcd14ca6a@0.7081 |
| compare-javascript-typescript-type-errors | TypeScript | TypeScript | 1:TypeScript/7c4ccaa942e40446@0.7668; 2:TypeScript/1ac6ec3e98653e9b@0.7580; 3:TypeScript/852dee0342e422e3@0.7539; 4:TypeScript/35a6a9c0a60b152d@0.7486 |
| compare-python-typescript-type-annotations | TypeScript | none | 1:TypeScript/1ac6ec3e98653e9b@0.7004; 2:TypeScript/ac402a55336257bd@0.7004; 3:TypeScript/852dee0342e422e3@0.6980; 4:TypeScript/97c7adbac8777b90@0.6954 |
| compare-go-rust-panic-recovery | Go + Rust | Go + Rust | 1:Rust/0b279a517bd3b054@0.7503; 2:Go/9cb23ea407465d5c@0.7470; 3:Rust/b1776b1f7794289b@0.7423; 4:Rust/016d288441967425@0.7383 |
| compare-java-cpp-multiple-inheritance | Java + C++ | C++ | 1:Java/4ff89fdf16fab7a1@0.7297; 2:C++/db08ba0a2ea8b691@0.7184; 3:Java/8998e0a810bb2795@0.6977; 4:C++/ba4a3cb800606c07@0.6935 |
| compare-bash-python-for-loops | Bash + Python | Bash + Python | 1:Bash/a92113350e4536f5@0.7079; 2:Bash/278fd7b1d1c9b3f0@0.6969; 3:Python/98e19280456ce52e@0.6952 |

### multi-technology-balanced

| Case | Languages represented | Canonical evidence represented | Retrieved chunks |
|---|---|---|---|
| compare-c-rust-heap-memory | C + Rust | Rust | 1:Rust/8238e2e53432bd18@0.7510; 2:C/885d375ea9a7664d@0.7130; 3:Rust/d2e6b82c3bebee4c@0.7347; 4:Rust/ead1311e43db94c9@0.7338 |
| compare-c-cpp-dynamic-deallocation | C + C++ | none | 1:C/ebd5f7d6ce28eec3@0.7248; 2:C++/402a75a061d344c4@0.6822; 3:C/885d375ea9a7664d@0.7217; 4:C/a7578e6ebf8efe8f@0.7010 |
| compare-java-kotlin-nullability | Kotlin | Kotlin | 1:Kotlin/de8e8d15fe992755@0.7295; 2:Kotlin/7be1556b0f36dcd8@0.7157; 3:Kotlin/7a10d737e9d75bdf@0.7116; 4:Kotlin/30450b4bcd14ca6a@0.7081 |
| compare-javascript-typescript-type-errors | TypeScript | TypeScript | 1:TypeScript/7c4ccaa942e40446@0.7668; 2:TypeScript/1ac6ec3e98653e9b@0.7580; 3:TypeScript/852dee0342e422e3@0.7539; 4:TypeScript/35a6a9c0a60b152d@0.7486 |
| compare-python-typescript-type-annotations | TypeScript | none | 1:TypeScript/1ac6ec3e98653e9b@0.7004; 2:TypeScript/ac402a55336257bd@0.7004; 3:TypeScript/852dee0342e422e3@0.6980; 4:TypeScript/97c7adbac8777b90@0.6954 |
| compare-go-rust-panic-recovery | Go + Rust | Go + Rust | 1:Rust/0b279a517bd3b054@0.7503; 2:Go/9cb23ea407465d5c@0.7470; 3:Rust/b1776b1f7794289b@0.7423; 4:Go/6c20e64faa491ac9@0.7173 |
| compare-java-cpp-multiple-inheritance | Java + C++ | C++ | 1:Java/4ff89fdf16fab7a1@0.7297; 2:C++/db08ba0a2ea8b691@0.7184; 3:Java/8998e0a810bb2795@0.6977; 4:C++/ba4a3cb800606c07@0.6935 |
| compare-bash-python-for-loops | Bash + Python | Bash + Python | 1:Bash/a92113350e4536f5@0.7079; 2:Python/98e19280456ce52e@0.6952; 3:Bash/278fd7b1d1c9b3f0@0.6969 |

## Scope and limitations

- Eight focused answerable validation cases are not a general retrieval benchmark.
- Canonical chunk IDs are tied to the frozen 300-word parent corpus.
- The experiment does not recalibrate threshold 0.68 or measure unanswerable false positives.
- The locked 24-case test split remains untouched.
