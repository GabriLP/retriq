# Specialized reranker comparison

- Protocol/attempt: `reranking-v1` / `20260717093322581`
- Split: **validation only**
- Hypothesis: A specialized cross-encoder can improve nDCG@4 over the already strong metadata-aware dense baseline by reordering a fixed top-20 candidate pool without reducing recall, MRR, or abstention quality.
- Candidate depth: 20; final topK: 4; dense abstention threshold: 0.68
- Candidate Recall@20: 1.0000; eligible queries: 27
- Selected variant: **no-reranker**

| Variant | Recall@4 | Precision@4 | MRR | nDCG@4 | nDCG lift | FPR | API calls | Tokens | Est. USD | Median ms | Eligible |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| no-reranker | 0.9630 | 0.6296 | 0.9444 | 0.9493 | 0.0000 | 0.0000 | 0 | 0 | 0.000000 | 0.00 | yes |
| voyage-rerank-2.5 | 0.9630 | 0.5556 | 0.9259 | 0.9327 | -0.0166 | 0.0000 | 27 | 255245 | 0.012762 | 327.27 | no |
| voyage-rerank-2.5-lite | 0.9630 | 0.5370 | 0.9012 | 0.9126 | -0.0367 | 0.0000 | 27 | 255245 | 0.005105 | 310.96 | no |

## Case-level movements

- **voyage-rerank-2.5:** improved `typescript-conditional-distribution-001`; worsened `react-effects-001`, `react-refs-001`, `java-ods-arraystack-amortized-001`.
- **voyage-rerank-2.5-lite:** improved `typescript-conditional-distribution-001`; worsened `react-state-snapshot-001`, `react-effects-001`, `react-refs-001`, `java-ods-arraystack-amortized-001`.

## Decision

Retain no-reranker; no specialized reranker satisfied the pre-registered lift and guardrails.

Answerable cases whose canonical evidence is absent from the candidate pool: none. Costs use list price and do not subtract free-tier credits. Latency includes local cache reads when present and therefore must be interpreted alongside cache/API counts. The locked test split was touched: **no**.
