# Thesis experiment map

- Registry: `retriq-thesis-experiment-registry@1.0.0`
- Experiment families: **15**
- Completed: **11**
- Superseded but retained: **1**

This is the narrative index for the thesis. The JSON registry is the source of truth; generated Markdown and CSV provide readable and tabular views. Every experiment records its question, isolated variable, controls, metrics, decision, limitations, and next action.

| Order | Thesis section | Experiment | Status | Variable | Decision |
|---:|---|---|---|---|---|
| 1 | Dataset and corpus construction | corpus-pdf-expansion | completed | Corpus source coverage and source format | Use the expanded PDF-first corpus as the common experimental corpus. |
| 2 | Benchmark construction and review | benchmark-v2-provisional-review | in-progress | Case coverage, answerability balance, approval provenance, and split membership | Use the 30-case balanced v2 benchmark for engineering validation. Keep the six newly curated cases as a locked fresh test; all operational human approvals remain explicitly pending independent user confirmation. |
| 3 | Chunking experiments | chunk-size-v1 | completed | Target chunk size: 850, 450, or 300 words | Retain 300 target words as the exploratory baseline. The 2x3 interaction validation confirms higher Gemini precision at 300 words and no model-ranking reversal. |
| 4 | Abstention calibration | threshold-seed-v1 | superseded | Dense cosine minimum score | The preliminary 0.65 threshold was superseded after expanding negative cases. |
| 5 | Abstention calibration | threshold-balanced-v2 | completed | Dense cosine minimum score | Select 0.75 on validation; retain the 1/6 test version false positive without retuning. |
| 6 | Retrieval strategy comparison | retrieval-strategies-v1 | completed | Retrieval strategy | Keep dense cosine; BM25 and simple RRF fail the declared guardrails. |
| 7 | Metadata-aware retrieval | metadata-version-filter-v1 | completed | Compatibility gate enabled or disabled | On the 54-case v4 validation split, the pre-registered v1 attempt failed because C++ queries were misclassified as C. After a tested detector correction, v2 selects metadata-aware dense at 0.68 with Recall@4 0.9630, MRR 0.9444, nDCG@4 0.9493, and zero no-answer false positives. Pure dense still has no threshold satisfying all guardrails. |
| 8 | Embedding model comparison | embedding-models-v2 | completed | Embedding provider/model at a fixed 1024-dimensional output | On the 54-case v4 validation split, retain Gemini Embedding 2 at threshold 0.68. It is the only 1024-dimensional candidate satisfying zero no-answer false positives, Recall@4 >= 0.90, and MRR >= 0.85. OpenAI Large is strongest at a permissive threshold but fails after zero-FPR calibration; Voyage preserves recall but misses the MRR floor. |
| 9 | Reranking | reranking-v1 | completed | No reranker, Voyage rerank-2.5, or Voyage rerank-2.5-lite | Retain no reranker. With candidate Recall@20 equal to 1.0, rerank-2.5 preserved Recall@4 but reduced MRR from 0.9444 to 0.9259 and nDCG@4 from 0.9493 to 0.9327; rerank-2.5-lite reduced them further. Both added cost and about 0.31-0.33 seconds median API latency. |
| 10 | Answer generation and LLM-as-a-judge | generation-and-judge-v1 | in-progress | Generator model first; judge model and judge prompt only after human reference labels exist | The 72-row blinded human review selects GLM-5.2 BaseTen FP8 on validation: normalized quality 0.9740, every guardrail passed, and the lowest observed generation cost. Grok 4.5 scored 0.9323 and passed all guardrails. Gemini 3.5 Flash scored 0.9219 but its one human-labelled generator failure produced a 4.17% rate, above the preregistered 2% limit. The locked test remains untouched. |
| 11 | Agentic RAG | rag-agent-loop-v1 | planned | Single pass versus bounded retrieve-check-rewrite loop | Pending. |
| 12 | Production retrieval infrastructure | postgres-vector-storage-v1 | completed | Local exhaustive cosine persistence versus exact pgvector execution | Deploy exact pgvector search on Neon Free. It preserved all 54 frozen validation outputs within a 0.0002 score tolerance, stored 33,079 chunks in 228 MB, reused cached embeddings with zero provider calls, and cost $0 at observation time. HNSW and IVFFlat remain deferred experiments. |
| 13 | Runtime generation reliability | generation-output-budget-v1 | completed | Maximum output-token budget: frozen 900-token baseline versus 2,048-token runtime candidate | Use 2,048 tokens for runtime reliability. All 27 validation generations returned STOP with zero errors and zero MAX_TOKENS events; the known 900-token Rust failure completed. Observed cost increased from $0.164763 to $0.166626 (+$0.001863, approximately 1.13%). This is not a quality-selection result. |
| 14 | Comparative-query retrieval | multi-technology-retrieval-v1 | completed | Legacy first-technology filtering versus multi-technology union versus language-balanced union | Retain language-balanced multi-technology ordering among the three preregistered policies. It raises both-language coverage@4 from 0.0000 for legacy first-match and 0.3750 for the unbalanced union to 0.6250. Canonical two-sided evidence coverage remains only 0.2500, however, so this is a retrieval regression fix rather than a complete comparative-query solution. |
| 15 | Comparative-query abstention calibration | comparative-threshold-calibration-v1 | completed | Balanced multi-technology minimum cosine threshold from 0.60 to 0.74 | Select no comparative threshold. Thresholds 0.60 and 0.62 reach 1.0000 both-language coverage but produce 1.0000 negative FPR. Threshold 0.72 reaches zero FPR but only 0.1250 both-language and both-evidence coverage. The maximum negative score (0.7122) exceeds the minimum positive top score (0.7004), while the weakest positive technology side reaches only 0.6441. |

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

## 2. Benchmark construction and review: benchmark-v2-provisional-review

- **Research question:** Can a balanced, source-grounded benchmark and a genuinely untouched test split support the next retrieval experiments?
- **Status:** in-progress
- **Changed variable:** Case coverage, answerability balance, approval provenance, and split membership
- **Controls:** Frozen corpus snapshot; Evidence page ranges; Reproducible absence probes; Previously scored cases excluded from the fresh test
- **Metrics:** Answerable/unanswerable balance; language/domain coverage; difficulty; absence-probe conflicts; approval confirmations
- **Artifacts:** `docs/evaluation/golden-set.v2.json`; `docs/evaluation/golden-set-splits.v2.json`; `docs/evaluation/golden-set-summary.v2.md`; `docs/evaluation/negative-case-verification.v2.md`; `docs/evaluation/HUMAN_REVIEW_CHECKLIST_V2.md`
- **Decision:** Use the 30-case balanced v2 benchmark for engineering validation. Keep the six newly curated cases as a locked fresh test; all operational human approvals remain explicitly pending independent user confirmation.
- **Limitations:** Only six fresh test cases; All approval records are provisional; Coverage remains uneven across the full corpus language set
- **Next step:** Confirm every checklist item, freeze the retrieval selection rule, then execute the six-case test exactly once.

## 3. Chunking experiments: chunk-size-v1

- **Research question:** How does target chunk size affect retrieval quality, index size, latency, and embedding cost?
- **Status:** completed
- **Changed variable:** Target chunk size: 850, 450, or 300 words
- **Controls:** Corpus snapshot; overlap; embedding model; retrieval; evaluation cases
- **Metrics:** Recall@4; Precision@4; MRR; nDCG@4; chunk count; estimated cost
- **Artifacts:** `docs/experiments/common-programming-chunk-size.v1.json`; `docs/experiment-results/common-chunk-size-retrieval-analysis.md`; `docs/experiments/embedding-chunk-interaction.v1.json`; `docs/experiment-results/embedding-chunk-interaction-validation.md`
- **Decision:** Retain 300 target words as the exploratory baseline. The 2x3 interaction validation confirms higher Gemini precision at 300 words and no model-ranking reversal.
- **Limitations:** Many source sections remain shorter than the configured minimum; Oversized source blocks require a separate boundary experiment
- **Next step:** Compare boundary and overlap strategies independently.

## 4. Abstention calibration: threshold-seed-v1

- **Research question:** Which cosine threshold suppresses unrelated retrieval without reducing answerable recall?
- **Status:** superseded
- **Changed variable:** Dense cosine minimum score
- **Controls:** 300-word chunks; embedding vectors; topK=4
- **Metrics:** No-answer FPR; Recall@4; MRR; nDCG@4
- **Artifacts:** `docs/experiments/common-programming-threshold-sweep.v1.json`; `docs/experiment-results/common-threshold-sweep.md`
- **Decision:** The preliminary 0.65 threshold was superseded after expanding negative cases.
- **Limitations:** Only one negative case; No validation/test split
- **Next step:** Use the balanced validation protocol.

## 5. Abstention calibration: threshold-balanced-v2

- **Research question:** Does a threshold selected on balanced validation generalize to an untouched test split?
- **Status:** completed
- **Changed variable:** Dense cosine minimum score
- **Controls:** Balanced validation/test splits; 300-word chunks; embedding vectors; topK=4
- **Metrics:** No-answer FPR; Recall@4; Precision@4; MRR; nDCG@4
- **Artifacts:** `docs/experiments/common-programming-threshold-sweep.v2.json`; `docs/experiment-results/common-threshold-sweep-validation.md`; `docs/experiment-results/common-threshold-held-out-test.md`
- **Decision:** Select 0.75 on validation; retain the 1/6 test version false positive without retuning.
- **Limitations:** Source-verified rather than human-approved cases; Small split size; Test is consumed for this configuration
- **Next step:** Evaluate explicit version compatibility on validation and create a future test revision before final comparison.

## 6. Retrieval strategy comparison: retrieval-strategies-v1

- **Research question:** Do lexical BM25 or unweighted hybrid RRF improve over dense cosine on the current benchmark?
- **Status:** completed
- **Changed variable:** Retrieval strategy
- **Controls:** Validation cases; corpus; chunks; topK=4
- **Metrics:** Recall@4; Precision@4; MRR; nDCG@4; No-answer FPR; latency
- **Artifacts:** `docs/experiments/common-retrieval-strategies.v1.json`; `docs/experiment-results/common-retrieval-strategies-validation.md`
- **Decision:** Keep dense cosine; BM25 and simple RRF fail the declared guardrails.
- **Limitations:** Benchmark has limited exact-lookup queries; BM25 uses a basic analyzer
- **Next step:** Prioritize metadata filtering and reranking; retain technical BM25 as an optional later variant.

## 7. Metadata-aware retrieval: metadata-version-filter-v1

- **Research question:** Can query-corpus technology and version compatibility reduce false positives without harming answerable retrieval?
- **Status:** completed
- **Changed variable:** Compatibility gate enabled or disabled
- **Controls:** Dense cosine rankings; validation split; threshold grid; topK=4
- **Metrics:** No-answer FPR; Recall@4; MRR; compatibility rejections; latency
- **Artifacts:** `docs/experiments/common-metadata-filter.v1.json`; `docs/experiment-results/common-metadata-filter-validation.md`; `docs/experiments/baseline-gemini-300-v2-metadata-filter.v1.json`; `docs/experiment-results/baseline-gemini-300-v2-metadata-filter-validation.md`; `docs/experiments/baseline-gemini-300-v4-validation.json`; `docs/experiment-results/baseline-gemini-300-v4-validation.md`; `docs/experiments/baseline-gemini-300-v4-metadata-filter.v1.json`; `docs/experiment-results/baseline-gemini-300-v4-metadata-filter-validation.md`; `docs/experiments/baseline-gemini-300-v4-metadata-filter.v2.json`; `docs/experiment-results/baseline-gemini-300-v4-metadata-filter-v2-validation.md`
- **Decision:** On the 54-case v4 validation split, the pre-registered v1 attempt failed because C++ queries were misclassified as C. After a tested detector correction, v2 selects metadata-aware dense at 0.68 with Recall@4 0.9630, MRR 0.9444, nDCG@4 0.9493, and zero no-answer false positives. Pure dense still has no threshold satisfying all guardrails.
- **Limitations:** Rule-based query recognition may miss implicit technologies or aliases; Metadata coverage and correctness become retrieval dependencies; One Python answerable case misses its exact canonical evidence page; All 78 approvals are provisional; The 24-case test remains intentionally untouched
- **Next step:** Use 0.68 as the current v4 validation threshold and rerun the embedding alternatives on the same frozen corpus and validation cases before any held-out test execution.

## 8. Embedding model comparison: embedding-models-v2

- **Research question:** Which embedding model and dimensionality provide the best quality-cost trade-off?
- **Status:** completed
- **Changed variable:** Embedding provider/model at a fixed 1024-dimensional output
- **Controls:** Frozen chunks; queries; retrieval strategy; topK
- **Metrics:** Recall@4; MRR; nDCG@4; latency; index size; cost
- **Artifacts:** `docs/experiments/embedding-models.v1.json`; `docs/experiment-results/embedding-model-readiness.md`; `docs/experiment-results/embedding-model-comparison-validation.md`; `docs/experiment-results/embedding-chunk-interaction-validation.md`; `docs/experiments/embedding-models.v2.json`; `docs/experiments/embedding-model-comparison-v4.runs.json`; `docs/experiment-results/embedding-model-comparison-v4-validation.md`; `docs/experiment-results/embedding-model-comparison-v4-validation.json`; `docs/experiment-results/embedding-model-comparison-v4-validation.csv`
- **Decision:** On the 54-case v4 validation split, retain Gemini Embedding 2 at threshold 0.68. It is the only 1024-dimensional candidate satisfying zero no-answer false positives, Recall@4 >= 0.90, and MRR >= 0.85. OpenAI Large is strongest at a permissive threshold but fails after zero-FPR calibration; Voyage preserves recall but misses the MRR floor.
- **Limitations:** Provider availability and prices may change; All 78 benchmark approvals remain provisional; The 24-case test split remains intentionally untouched; Indexing latency is not comparable because cache resumptions and provider rate limits differed; A Voyage retry added separately reported redundant API cost
- **Next step:** Freeze Gemini Embedding 2 with metadata-aware retrieval at 0.68, then compare reranking or answer generation while changing one variable family at a time.

## 9. Reranking: reranking-v1

- **Research question:** Does reranking a fixed dense candidate pool improve ordering quality enough to justify added latency and cost?
- **Status:** completed
- **Changed variable:** No reranker, Voyage rerank-2.5, or Voyage rerank-2.5-lite
- **Controls:** Gemini Embedding 2; metadata gate; cosine abstention threshold 0.68; candidate depth 20; final topK=4; corpus; validation queries
- **Metrics:** MRR; nDCG@4; Recall@4; latency; cost
- **Artifacts:** `docs/experiments/reranking-v1.json`; `docs/experiment-results/reranking-v1-validation.md`; `docs/experiment-results/reranking-v1-validation.csv`
- **Decision:** Retain no reranker. With candidate Recall@20 equal to 1.0, rerank-2.5 preserved Recall@4 but reduced MRR from 0.9444 to 0.9259 and nDCG@4 from 0.9493 to 0.9327; rerank-2.5-lite reduced them further. Both added cost and about 0.31-0.33 seconds median API latency.
- **Limitations:** Only one provider family was tested; The baseline leaves little headroom; All benchmark approvals remain provisional; Latency reflects one API run from Europe/Rome; The 24-case test remains untouched
- **Next step:** Keep the simpler metadata-aware dense retriever and proceed to frozen-evidence answer generation and judge calibration.

## 10. Answer generation and LLM-as-a-judge: generation-and-judge-v1

- **Research question:** How do generator choices affect grounded answer quality, and how reliably can an LLM judge reproduce human assessments?
- **Status:** in-progress
- **Changed variable:** Generator model first; judge model and judge prompt only after human reference labels exist
- **Controls:** Frozen retrieved evidence; answer prompt; human-labelled judge subset
- **Metrics:** Key-fact coverage; groundedness; citation correctness; judge agreement; latency; cost
- **Artifacts:** `docs/experiments/generation-models.v1.json`; `docs/evaluation/generation-benchmark.v1.json`; `docs/evaluation/generation-benchmark.v1.md`; `docs/evaluation/generation-benchmark.v1.csv`; `docs/evaluation/generation-prompt.v1.json`; `docs/evaluation/generation-human-rubric.v1.json`; `docs/evaluation/GENERATION_HUMAN_REVIEW_GUIDE_V1.md`; `docs/evaluation/generation-human-review-v1.csv`; `docs/evaluation/generation-human-review-v1.completed.csv`; `docs/experiment-results/generation-model-comparison-v1-validation.json`; `docs/experiment-results/generation-model-comparison-v1-validation.md`; `docs/experiment-results/generation-human-review-v1-summary.json`; `docs/experiment-results/generation-human-review-v1-summary.md`
- **Decision:** The 72-row blinded human review selects GLM-5.2 BaseTen FP8 on validation: normalized quality 0.9740, every guardrail passed, and the lowest observed generation cost. Grok 4.5 scored 0.9323 and passed all guardrails. Gemini 3.5 Flash scored 0.9219 but its one human-labelled generator failure produced a 4.17% rate, above the preregistered 2% limit. The locked test remains untouched.
- **Limitations:** All benchmark approvals remain provisional; The initial reference labels have one primary human reviewer and were completed quickly; Judge must not validate itself; Provider-side tokenization and reasoning semantics differ despite the shared nominal low-effort control; One transient GLM 429 required a cache-preserving single-case retry; The 24-case test remains untouched
- **Next step:** Preregister independent LLM-judge candidates and prompt variants, calibrate them only against these human validation labels, then audit disagreements before freezing the judge.

## 11. Agentic RAG: rag-agent-loop-v1

- **Research question:** Does retrieve-check-rewrite improve success enough to justify extra iterations, latency, and cost?
- **Status:** planned
- **Changed variable:** Single pass versus bounded retrieve-check-rewrite loop
- **Controls:** Corpus; retriever; generator; maximum budget
- **Metrics:** Task success; iterations; latency; tokens; cost; failure rate
- **Artifacts:** not created yet
- **Decision:** Pending.
- **Limitations:** Must not hide a weak single-pass baseline
- **Next step:** Run only after retrieval, generation, and judge baselines are frozen.

## 12. Production retrieval infrastructure: postgres-vector-storage-v1

- **Research question:** Can the frozen metadata-aware dense retriever be deployed on managed PostgreSQL without changing its validation outputs?
- **Status:** completed
- **Changed variable:** Local exhaustive cosine persistence versus exact pgvector execution
- **Controls:** Frozen 33,079-chunk corpus; Gemini Embedding 2 at 1,024 dimensions; metadata gate; threshold 0.68; topK=4; no reranker; validation only
- **Metrics:** Exact ranking agreement; cosine-score tolerance; database size; provider requests; cost; operational smoke-test latency
- **Artifacts:** `docs/experiments/postgres-vector-storage.v1.json`; `docs/experiment-results/postgres-vector-storage-v1.json`; `docs/experiment-results/postgres-vector-storage-v1.md`; `db/migrations/001_pgvector_runtime.sql`; `db/migrations/002_preserve_duplicate_chunk_ids.sql`
- **Decision:** Deploy exact pgvector search on Neon Free. It preserved all 54 frozen validation outputs within a 0.0002 score tolerance, stored 33,079 chunks in 228 MB, reused cached embeddings with zero provider calls, and cost $0 at observation time. HNSW and IVFFlat remain deferred experiments.
- **Limitations:** One operational latency sample is not a benchmark; Free compute can cold-start; Additional corpus or embedding versions require storage monitoring; The locked test remains untouched
- **Next step:** Collect repeated production latency samples and evaluate HNSW only if exact-search latency becomes materially problematic.

## 13. Runtime generation reliability: generation-output-budget-v1

- **Research question:** Does raising Gemini's output ceiling from 900 to 2,048 tokens eliminate observed mid-answer truncation at acceptable incremental cost while keeping every other generation input fixed?
- **Status:** completed
- **Changed variable:** Maximum output-token budget: frozen 900-token baseline versus 2,048-token runtime candidate
- **Controls:** 27 answerable validation cases; frozen retrieval evidence; Gemini 3.5 Flash; grounded prompt v1; temperature 0; low reasoning effort; judge disabled
- **Metrics:** MAX_TOKENS stop rate; confirmed abrupt completions; errors; completion and reasoning tokens; cost; latency; response length
- **Artifacts:** `docs/experiments/generation-output-budget.v1.json`; `docs/experiment-results/generation-output-budget-v1-validation.json`; `docs/experiment-results/generation-output-budget-v1-validation.md`; `docs/experiment-results/generation-output-budget-v1-validation.csv`; `docs/evaluation/generation-output-budget-human-review-v1.csv`
- **Decision:** Use 2,048 tokens for runtime reliability. All 27 validation generations returned STOP with zero errors and zero MAX_TOKENS events; the known 900-token Rust failure completed. Observed cost increased from $0.164763 to $0.166626 (+$0.001863, approximately 1.13%). This is not a quality-selection result.
- **Limitations:** Legacy finish reasons were not retained, so the 900-token truncation rate is a confirmed lower bound; Temperature zero does not guarantee byte-identical regeneration; Quality comparison remains pending human review or an independently calibrated judge; The 24-case test remains untouched
- **Next step:** Retain 2,048 as the runtime ceiling, preserve the blinded quality-review package, and continue with the separately preregistered comparative-query retrieval benchmark before judge calibration.

## 14. Comparative-query retrieval: multi-technology-retrieval-v1

- **Research question:** For questions comparing two programming technologies, which metadata filtering and top-k policy best represents and grounds both sides?
- **Status:** completed
- **Changed variable:** Legacy first-technology filtering versus multi-technology union versus language-balanced union
- **Controls:** Frozen 33,079-chunk corpus; 300-word target chunks; Gemini Embedding 2 at 1,024 dimensions; exact cosine retrieval; threshold 0.68; topK=4; no reranker; eight source-verified validation cases
- **Metrics:** Both-language coverage@4; mean language-side coverage@4; both-evidence-side coverage@4; canonical evidence-side recall@4; macro evidence-side MRR; latency; embedding cost
- **Artifacts:** `docs/evaluation/multi-technology-retrieval-benchmark.v1.json`; `docs/experiments/multi-technology-retrieval.v1.json`; `docs/experiment-results/multi-technology-retrieval-v1-validation.json`; `docs/experiment-results/multi-technology-retrieval-v1-validation.md`; `docs/experiment-results/multi-technology-retrieval-v1-validation.csv`
- **Decision:** Retain language-balanced multi-technology ordering among the three preregistered policies. It raises both-language coverage@4 from 0.0000 for legacy first-match and 0.3750 for the unbalanced union to 0.6250. Canonical two-sided evidence coverage remains only 0.2500, however, so this is a retrieval regression fix rather than a complete comparative-query solution.
- **Limitations:** Only eight focused answerable validation cases; Canonical evidence is tied to the frozen 300-word chunks; Threshold 0.68 was inherited from the general single-technology benchmark; No comparative unanswerable cases; The locked 24-case test remains untouched
- **Next step:** Preregister a comparative-query calibration that varies candidate budget or a per-language quota while preserving an explicit abstention rule; do not silently lower the global threshold.

## 15. Comparative-query abstention calibration: comparative-threshold-calibration-v1

- **Research question:** Can a dedicated cosine threshold improve two-sided comparative retrieval while preserving abstention on comparative negatives?
- **Status:** completed
- **Changed variable:** Balanced multi-technology minimum cosine threshold from 0.60 to 0.74
- **Controls:** Frozen 33,079-chunk corpus; eight comparative positives; eight comparative negatives; Gemini Embedding 2 at 1,024 dimensions; language-balanced retrieval; topK=4; no reranker
- **Metrics:** Comparative no-answer FPR; both-language coverage@4; both-evidence-side coverage@4; canonical evidence-side recall@4; macro evidence-side MRR; score separation; cost
- **Artifacts:** `docs/evaluation/multi-technology-negative-benchmark.v1.json`; `docs/evaluation/multi-technology-negative-verification.v1.md`; `docs/experiments/comparative-threshold-calibration.v1.json`; `docs/experiment-results/comparative-threshold-calibration-v1-validation.json`; `docs/experiment-results/comparative-threshold-calibration-v1-validation.md`; `docs/experiment-results/comparative-threshold-calibration-v1-validation.csv`
- **Decision:** Select no comparative threshold. Thresholds 0.60 and 0.62 reach 1.0000 both-language coverage but produce 1.0000 negative FPR. Threshold 0.72 reaches zero FPR but only 0.1250 both-language and both-evidence coverage. The maximum negative score (0.7122) exceeds the minimum positive top score (0.7004), while the weakest positive technology side reaches only 0.6441.
- **Limitations:** Only eight positive and eight negative validation cases; Exact absence probes are sanity checks rather than semantic proof; Only the threshold changed; The locked general test remains untouched
- **Next step:** Test an explicit comparative-query architecture such as per-technology query decomposition followed by an answerability or evidence-sufficiency gate; retain 0.68 for ordinary single-technology retrieval.
