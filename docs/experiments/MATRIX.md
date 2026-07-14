# Experimental matrix and decision register

Each row is a candidate configuration, including alternatives that fail or are rejected. A choice becomes a thesis conclusion only after controlled runs share the same corpus hash, golden-set hash, review-state filter, and evaluation protocol.

| Component | Alternatives to test | Controlled variables | Primary metrics | Current state |
|---|---|---|---|---|
| Chunking size | 300, 450, 850 words | Same overlap ratio/model/retrieval | Recall@k, MRR, nDCG, chunk count, latency | 450 and 850 preparation runs exist; retrieval metrics pending |
| Chunk overlap | 0%, about 10%, about 20% | Same target size/model | Recall@k, duplicate-hit rate, indexed words, latency | Planned |
| Chunk boundary | Word window, heading-aware, semantic | Same target budget/model | Evidence hit rate, MRR, context coherence | Word window baseline implemented; alternatives planned |
| Embedding | Current Gemini baseline plus at least two supported alternatives | Same chunks/questions/top-k | Recall@k, MRR, nDCG, latency, cost | Runner parameterized; model shortlist must be verified before runs |
| Retrieval | Dense cosine, BM25, hybrid fusion | Same chunks/golden set/top-k | Recall@k, Precision@k, MRR, nDCG | Dense cosine implemented |
| Reranking | None, cross-encoder, LLM reranker | Same candidate pool and final k | nDCG, MRR, latency, cost | Planned |
| Threshold | Fixed score grid and validation-set tuning | Same model/top-k | No-answer false positives/negatives, recall | Baseline 0.18; sweep planned |
| Generator | Existing baseline plus two models | Frozen retrieved evidence | Key-fact coverage, groundedness, citations, latency, cost | Planned after retrieval benchmark |
| Judge | Disabled, judge model A/B, prompt variants | Human-labelled calibration subset | Agreement, confusion matrix, rank correlation | Foundation exists; calibration planned |
| Agent loop | Single pass, query rewrite, retrieve-check-retry | Same maximum budget and corpus | Success lift, iterations, latency, cost | Deferred until single-pass baselines are stable |

## Reporting rule

For every run, retain the hypothesis, complete configuration, source and dataset hashes, code fingerprint, environment, raw per-case outputs, aggregate metrics, failures, latency, and—where available—token/cost usage. Rejected alternatives remain in the registry with a reason; they are not deleted from the narrative.
