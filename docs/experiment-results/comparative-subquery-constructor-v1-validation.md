# Comparative subquery constructor

- Protocol/attempt: `comparative-subquery-constructor-v1` / `20260721093756140`
- Evaluation commit: `783a6e0ea284882a7365b6e7d924ba5dadf8483f`
- Split: **validation only**; locked test touched: **no**
- Fixed: both-sides gate, cosine >= 0.68, two chunks per technology, no reranker or LLM rewrite
- Provider inputs: **64** in **2** request(s), estimated cost **$0.00034460**

| Constructor | Both languages @4 | Both evidence sides @4 | Evidence recall | Side MRR | Negative FPR | Positive rejects | Parse success | Query chars |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| manual-frozen | 1.0000 | 0.3750 | 0.6250 | 0.4271 | 0.0000 | 0 | 1.0000 | 1726 |
| automatic-focus-original | 0.7500 | 0.2500 | 0.4375 | 0.3125 | 0.1250 | 2 | 1.0000 | 2744 |
| automatic-topic-template | 1.0000 | 0.3750 | 0.5625 | 0.4271 | 0.0000 | 0 | 1.0000 | 1876 |

## Decision

**No automatic constructor selected.** Retain the manual frozen reference and select no automatic constructor if neither automatic variant satisfies every guardrail.

## Limitations

- The parser supports the comparative forms represented in this focused benchmark, not arbitrary natural language.
- The manual reference is a validation reference rather than an independent test oracle.
- The gate measures score eligibility rather than semantic entailment.
- Production behavior and the locked general test remain untouched.
