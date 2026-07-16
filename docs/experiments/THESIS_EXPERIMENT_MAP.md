# Thesis experiment map

- Registry: `retriq-thesis-experiment-registry@1.0.0`
- Experiment families: **10**
- Completed: **5**
- Superseded but retained: **1**

This is the narrative index for the thesis. The JSON registry is the source of truth; generated Markdown and CSV provide readable and tabular views. Every experiment records its question, isolated variable, controls, metrics, decision, limitations, and next action.

| Order | Thesis section | Experiment | Status | Variable | Decision |
|---:|---|---|---|---|---|
| 1 | Dataset and corpus construction | corpus-pdf-expansion | completed | Corpus source coverage and source format | Use the expanded PDF-first corpus as the common experimental corpus. |
| 2 | Chunking experiments | chunk-size-v1 | completed | Target chunk size: 850, 450, or 300 words | Retain 300 target words as the exploratory baseline. |
| 3 | Abstention calibration | threshold-seed-v1 | superseded | Dense cosine minimum score | The preliminary 0.65 threshold was superseded after expanding negative cases. |
| 4 | Abstention calibration | threshold-balanced-v2 | completed | Dense cosine minimum score | Select 0.75 on validation; retain the 1/6 test version false positive without retuning. |
| 5 | Retrieval strategy comparison | retrieval-strategies-v1 | completed | Retrieval strategy | Keep dense cosine; BM25 and simple RRF fail the declared guardrails. |
| 6 | Metadata-aware retrieval | metadata-version-filter-v1 | completed | Compatibility gate enabled or disabled | On validation, metadata-aware dense reaches zero no-answer FPR at 0.18 while preserving Recall@4, MRR, and nDCG@4 at 1.0; retain it as a promising candidate, not a final winner. |
| 7 | Embedding model comparison | embedding-models-v1 | planned | Embedding model and, separately, output dimensionality | Pending. |
| 8 | Reranking | reranking-v1 | planned | No reranker, cross-encoder, or LLM reranker | Pending. |
| 9 | Answer generation and LLM-as-a-judge | generation-and-judge-v1 | planned | Generator model, judge model, and judge prompt in separate experiments | Pending. |
| 10 | Agentic RAG | rag-agent-loop-v1 | planned | Single pass versus bounded retrieve-check-rewrite loop | Pending. |

## 1. Dataset and corpus construction: corpus-pdf-expansion

- **Research question:** Can a reproducible multi-language corpus be built primarily from versioned PDF documentation while retaining HTML where PDFs are unavailable?
- **Status:** completed
- **Changed variable:** Corpus source coverage and source format
- **Controls:** Official or authoritative sources; Manifest-based acquisition; Hashed source snapshots
- **Metrics:** Documents; languages; PDF parsing quality; chunks
- **Artifacts:** `docs/corpus/programming-foundation.json`; `docs/corpus/coverage-audit.json`; `docs/corpus/pdf-smoke-report.json`
- **Decision:** Use the expanded PDF-first corpus as the common experimental corpus.
- **Limitations:** Some living documentation remains HTML; Corpus balance by language is not uniform
- **Next step:** Preserve corpus hashes in every experiment.

## 2. Chunking experiments: chunk-size-v1

- **Research question:** How does target chunk size affect retrieval quality, index size, latency, and embedding cost?
- **Status:** completed
- **Changed variable:** Target chunk size: 850, 450, or 300 words
- **Controls:** Corpus snapshot; overlap; embedding model; retrieval; evaluation cases
- **Metrics:** Recall@4; Precision@4; MRR; nDCG@4; chunk count; estimated cost
- **Artifacts:** `docs/experiments/common-programming-chunk-size.v1.json`; `docs/experiment-results/common-chunk-size-retrieval-analysis.md`
- **Decision:** Retain 300 target words as the exploratory baseline.
- **Limitations:** Many source sections remain shorter than the configured minimum; Oversized source blocks require a separate boundary experiment
- **Next step:** Compare boundary and overlap strategies independently.

## 3. Abstention calibration: threshold-seed-v1

- **Research question:** Which cosine threshold suppresses unrelated retrieval without reducing answerable recall?
- **Status:** superseded
- **Changed variable:** Dense cosine minimum score
- **Controls:** 300-word chunks; embedding vectors; topK=4
- **Metrics:** No-answer FPR; Recall@4; MRR; nDCG@4
- **Artifacts:** `docs/experiments/common-programming-threshold-sweep.v1.json`; `docs/experiment-results/common-threshold-sweep.md`
- **Decision:** The preliminary 0.65 threshold was superseded after expanding negative cases.
- **Limitations:** Only one negative case; No validation/test split
- **Next step:** Use the balanced validation protocol.

## 4. Abstention calibration: threshold-balanced-v2

- **Research question:** Does a threshold selected on balanced validation generalize to an untouched test split?
- **Status:** completed
- **Changed variable:** Dense cosine minimum score
- **Controls:** Balanced validation/test splits; 300-word chunks; embedding vectors; topK=4
- **Metrics:** No-answer FPR; Recall@4; Precision@4; MRR; nDCG@4
- **Artifacts:** `docs/experiments/common-programming-threshold-sweep.v2.json`; `docs/experiment-results/common-threshold-sweep-validation.md`; `docs/experiment-results/common-threshold-held-out-test.md`
- **Decision:** Select 0.75 on validation; retain the 1/6 test version false positive without retuning.
- **Limitations:** Source-verified rather than human-approved cases; Small split size; Test is consumed for this configuration
- **Next step:** Evaluate explicit version compatibility on validation and create a future test revision before final comparison.

## 5. Retrieval strategy comparison: retrieval-strategies-v1

- **Research question:** Do lexical BM25 or unweighted hybrid RRF improve over dense cosine on the current benchmark?
- **Status:** completed
- **Changed variable:** Retrieval strategy
- **Controls:** Validation cases; corpus; chunks; topK=4
- **Metrics:** Recall@4; Precision@4; MRR; nDCG@4; No-answer FPR; latency
- **Artifacts:** `docs/experiments/common-retrieval-strategies.v1.json`; `docs/experiment-results/common-retrieval-strategies-validation.md`
- **Decision:** Keep dense cosine; BM25 and simple RRF fail the declared guardrails.
- **Limitations:** Benchmark has limited exact-lookup queries; BM25 uses a basic analyzer
- **Next step:** Prioritize metadata filtering and reranking; retain technical BM25 as an optional later variant.

## 6. Metadata-aware retrieval: metadata-version-filter-v1

- **Research question:** Can query-corpus technology and version compatibility reduce false positives without harming answerable retrieval?
- **Status:** completed
- **Changed variable:** Compatibility gate enabled or disabled
- **Controls:** Dense cosine rankings; validation split; threshold grid; topK=4
- **Metrics:** No-answer FPR; Recall@4; MRR; compatibility rejections; latency
- **Artifacts:** `docs/experiments/common-metadata-filter.v1.json`; `docs/experiment-results/common-metadata-filter-validation.md`
- **Decision:** On validation, metadata-aware dense reaches zero no-answer FPR at 0.18 while preserving Recall@4, MRR, and nDCG@4 at 1.0; retain it as a promising candidate, not a final winner.
- **Limitations:** Test split already consumed by the previous threshold experiment; Rule-based query recognition may miss implicit technologies or aliases; Metadata coverage and correctness become retrieval dependencies
- **Next step:** Expand compatibility-focused validation cases and create a fresh held-out split before claiming generalization.

## 7. Embedding model comparison: embedding-models-v1

- **Research question:** Which embedding model and dimensionality provide the best quality-cost trade-off?
- **Status:** planned
- **Changed variable:** Embedding model and, separately, output dimensionality
- **Controls:** Frozen chunks; queries; retrieval strategy; topK
- **Metrics:** Recall@4; MRR; nDCG@4; latency; index size; cost
- **Artifacts:** not created yet
- **Decision:** Pending.
- **Limitations:** Provider availability and prices may change
- **Next step:** Define a dated model shortlist.

## 8. Reranking: reranking-v1

- **Research question:** Does reranking a fixed dense candidate pool improve ordering quality enough to justify added latency and cost?
- **Status:** planned
- **Changed variable:** No reranker, cross-encoder, or LLM reranker
- **Controls:** Candidate pool; final topK; corpus; queries
- **Metrics:** MRR; nDCG@4; Recall@4; latency; cost
- **Artifacts:** not created yet
- **Decision:** Pending.
- **Limitations:** Requires a larger ranking-sensitive benchmark
- **Next step:** Run after metadata-aware retrieval.

## 9. Answer generation and LLM-as-a-judge: generation-and-judge-v1

- **Research question:** How do generator choices affect grounded answer quality, and how reliably can an LLM judge reproduce human assessments?
- **Status:** planned
- **Changed variable:** Generator model, judge model, and judge prompt in separate experiments
- **Controls:** Frozen retrieved evidence; answer prompt; human-labelled judge subset
- **Metrics:** Key-fact coverage; groundedness; citation correctness; judge agreement; latency; cost
- **Artifacts:** not created yet
- **Decision:** Pending.
- **Limitations:** Judge must not validate itself; Human calibration is required
- **Next step:** Build human-labelled calibration cases after retrieval stabilizes.

## 10. Agentic RAG: rag-agent-loop-v1

- **Research question:** Does retrieve-check-rewrite improve success enough to justify extra iterations, latency, and cost?
- **Status:** planned
- **Changed variable:** Single pass versus bounded retrieve-check-rewrite loop
- **Controls:** Corpus; retriever; generator; maximum budget
- **Metrics:** Task success; iterations; latency; tokens; cost; failure rate
- **Artifacts:** not created yet
- **Decision:** Pending.
- **Limitations:** Must not hide a weak single-pass baseline
- **Next step:** Run only after retrieval, generation, and judge baselines are frozen.
