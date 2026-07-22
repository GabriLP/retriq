# Thesis experiment map

- Registry: `retriq-thesis-experiment-registry@1.0.0`
- Experiment families: **21**
- Completed: **15**
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
| 11 | Agentic RAG | rag-agent-loop-v1 | completed | Single-pass retrieval versus a deterministic sufficiency gate and at most one Gemini 3.5 Flash rewrite attempt | Planner v3 completed all 70 cases but was not selected. A subsequent offline GPT-5.4 Mini semantic assessor improved frozen evidence-state accuracy from 0.9545 to 0.9727 and reduced FPR from 0.0610 to 0.0366 at $0.111858, but failed the preregistered zero-FPR rule. Its three disagreements contain plausible alternative evidence, so automatic integration remains disabled pending separate human adjudication. |
| 12 | Production retrieval infrastructure | postgres-vector-storage-v1 | completed | Local exhaustive cosine persistence versus exact pgvector execution | Deploy exact pgvector search on Neon Free. It preserved all 54 frozen validation outputs within a 0.0002 score tolerance, stored 33,079 chunks in 228 MB, reused cached embeddings with zero provider calls, and cost $0 at observation time. HNSW and IVFFlat remain deferred experiments. |
| 13 | Runtime generation reliability | generation-output-budget-v1 | completed | Maximum output-token budget: frozen 900-token baseline versus 2,048-token runtime candidate | Use 2,048 tokens for runtime reliability. All 27 validation generations returned STOP with zero errors and zero MAX_TOKENS events; the known 900-token Rust failure completed. Observed cost increased from $0.164763 to $0.166626 (+$0.001863, approximately 1.13%). This is not a quality-selection result. |
| 14 | Comparative-query retrieval | multi-technology-retrieval-v1 | completed | Legacy first-technology filtering versus multi-technology union versus language-balanced union | Retain language-balanced multi-technology ordering among the three preregistered policies. It raises both-language coverage@4 from 0.0000 for legacy first-match and 0.3750 for the unbalanced union to 0.6250. Canonical two-sided evidence coverage remains only 0.2500, however, so this is a retrieval regression fix rather than a complete comparative-query solution. |
| 15 | Comparative-query abstention calibration | comparative-threshold-calibration-v1 | completed | Balanced multi-technology minimum cosine threshold from 0.60 to 0.74 | Select no comparative threshold. Thresholds 0.60 and 0.62 reach 1.0000 both-language coverage but produce 1.0000 negative FPR. Threshold 0.72 reaches zero FPR but only 0.1250 both-language and both-evidence coverage. The maximum negative score (0.7122) exceeds the minimum positive top score (0.7004), while the weakest positive technology side reaches only 0.6441. |
| 16 | Comparative-query decomposition | comparative-query-decomposition-v1 | completed | Single balanced query versus decomposed per-technology queries, with and without a both-sides gate | Select decomposed retrieval with a both-sides evidence gate. Compared with the balanced single-query baseline, it raises both-language coverage@4 from 0.6250 to 1.0000, both-evidence-side coverage from 0.2500 to 0.3750, evidence-side recall from 0.5000 to 0.6250, and side MRR from 0.3646 to 0.4271. The ungated decomposed variant has 0.5000 negative FPR; the gate reduces this to zero while rejecting no positives. |
| 17 | Automatic comparative-query construction | comparative-subquery-constructor-v1 | completed | Manual subqueries versus focus-original and parsed-topic deterministic constructors | Select no deterministic constructor. Focus-original reduces both-language coverage to 0.7500, evidence-side recall to 0.4375, and introduces 0.1250 negative FPR. The parsed-topic template preserves 1.0000 both-language coverage, 0.3750 both-evidence coverage, 0.4271 side MRR, and zero FPR, but misses the 0.6250 recall floor at 0.5625 because it loses the Python evidence for the type-annotation case. |
| 18 | LLM-as-a-judge calibration | llm-judge-calibration-v1 | failed | Independent GPT-5.4 Nano judge at medium reasoning with one frozen rubric prompt | Stop before agreement analysis. The third response exposed an ambiguity in the single nullable JSON schema; two valid responses cost $0.0031475 and one additional request has unavailable usage. No human score was inspected for the repair. |
| 19 | LLM-as-a-judge calibration | llm-judge-calibration-v1.1 | failed | Answerability-specific response schema; every scientific and provider control remains identical to v1 | Do not select GPT-5.4 Nano prompt v1. Calibration QWK 0.4320 and Spearman 0.3570 missed their 0.60 and 0.70 floors, although pass agreement was 0.8333. Held-out audit QWK 0.1912, Spearman 0.4948, and pass agreement 0.7917 all failed. Abstention agreement was 1.0. Valid responses cost $0.046874; two provider responses without model identity were rejected. |
| 20 | LLM judge reference adjudication | judge-human-adjudication-v1 | completed | Second time-separated review with blind scoring followed by explicit comparison and adjudication | Treat the completed review as a human-in-the-loop sensitivity analysis, not as an independent replacement gold standard. Fourteen of 15 decisions confirmed the new blind score and one answerable case was revised to the judge after comparison. Replacing the 12 answerable audit labels with the final adjudicated labels raises cached audit QWK from 0.1912 to 0.6407, Spearman from 0.4948 to 0.9214, and binary pass agreement from 0.7917 to 0.8750, crossing every frozen audit threshold without provider calls. GPT-5.4 Nano nevertheless remains ineligible because the unchanged calibration split still fails QWK and Spearman. |
| 21 | LLM-as-a-judge calibration | llm-judge-calibration-v2 | failed | GPT-5.4 Mini replaces GPT-5.4 Nano; every prompt, schema, split, metric, threshold, reasoning, and routing control remains frozen | Do not select GPT-5.4 Mini. It improved over Nano on every primary calibration metric: QWK 0.5975 versus 0.4320, Spearman 0.4893 versus 0.3570, and binary pass agreement 0.9375 versus 0.8333. It nevertheless missed the frozen QWK floor of 0.60 by 0.0025 and the Spearman floor of 0.70 materially. All 32 unique responses were valid, provider-pinned, and completed without errors for $0.110033. Per protocol, neither the old inspected audit nor the locked generation test was accessed. |

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
- **Next step:** Audit GPT-5.4 Nano disagreements against the single-reviewer human reference; keep the judge disabled and preregister any stronger-model attempt separately.

## 11. Agentic RAG: rag-agent-loop-v1

- **Research question:** Can a bounded retrieval-assessment-rewrite loop improve evidence coverage over the frozen single-pass RAG baseline without unacceptable false positives, latency, or cost?
- **Status:** completed
- **Changed variable:** Single-pass retrieval versus a deterministic sufficiency gate and at most one Gemini 3.5 Flash rewrite attempt
- **Controls:** production baseline unchanged; Gemini 3.5 Flash low planner; deterministic 0.68 score and language-coverage assessor; maximum two retrieval attempts; maximum two queries per attempt; one controlled structured-output recovery; 512-token final planner budget; complete raw and compact trace; locked test untouched
- **Metrics:** Recall@4; MRR; nDCG@4; both-side evidence coverage; unanswerable false-positive rate; attempts; latency; tokens; cost
- **Artifacts:** `docs/experiments/agentic-rag.v1.json`; `docs/experiments/agentic-rag-planner.v1.json`; `docs/experiments/agentic-rag-planner.v2.json`; `docs/experiments/agentic-rag-planner.v3.json`; `docs/experiments/agentic-semantic-assessor.v1.json`; `docs/experiment-results/agentic-rag-planner-v1-validation.json`; `docs/experiment-results/agentic-rag-planner-v1-validation.md`; `docs/experiment-results/agentic-rag-planner-v2-validation.json`; `docs/experiment-results/agentic-rag-planner-v2-validation.md`; `docs/experiment-results/agentic-rag-planner-v3-validation.json`; `docs/experiment-results/agentic-rag-planner-v3-validation.md`; `docs/experiment-results/agentic-rag-planner-v3-validation.csv`; `docs/experiment-results/agentic-semantic-assessor-v1-validation.json`; `docs/experiment-results/agentic-semantic-assessor-v1-validation.md`; `src/lib/rag/agentic-retrieval.ts`; `src/lib/rag/agentic-assessor.ts`; `src/lib/rag/agentic-planner.ts`; `src/lib/rag/semantic-evidence-assessor.ts`; `scripts/test-agentic-retrieval.ts`; `scripts/test-agentic-policy.ts`; `scripts/test-semantic-evidence-assessor.ts`; `scripts/evaluate-agentic-rag.ts`; `scripts/evaluate-semantic-evidence-assessor.ts`
- **Decision:** Planner v3 completed all 70 cases but was not selected. A subsequent offline GPT-5.4 Mini semantic assessor improved frozen evidence-state accuracy from 0.9545 to 0.9727 and reduced FPR from 0.0610 to 0.0366 at $0.111858, but failed the preregistered zero-FPR rule. Its three disagreements contain plausible alternative evidence, so automatic integration remains disabled pending separate human adjudication.
- **Limitations:** Validation cases have informed prior retrieval experiments; The deterministic score-and-language assessor mistakes plausible but irrelevant evidence for sufficient evidence; Highest-score merging can let one comparison side crowd out the other; Agentic answer generation remains out of scope; The complete trace is descriptive on validation and must not become post-hoc tuning of this result
- **Next step:** Create a blinded three-case human adjudication of semantic sufficiency. Use it only to characterize canonical-label limitations and to justify any newly preregistered evidence-label expansion; do not retroactively select assessor v1.

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

## 16. Comparative-query decomposition: comparative-query-decomposition-v1

- **Research question:** Can per-technology query decomposition plus a both-sides evidence gate improve comparative retrieval without accepting comparative negatives?
- **Status:** completed
- **Changed variable:** Single balanced query versus decomposed per-technology queries, with and without a both-sides gate
- **Controls:** Frozen 33,079-chunk corpus; eight comparative positives and eight negatives; Gemini Embedding 2 at 1,024 dimensions; cosine threshold 0.68; maximum four chunks; two chunks per technology; no reranker; no LLM rewriting
- **Metrics:** Comparative no-answer FPR; both-language coverage@4; both-evidence-side coverage@4; canonical evidence-side recall@4; macro evidence-side MRR; gate rejections; cost
- **Artifacts:** `docs/evaluation/comparative-query-decomposition.v1.json`; `docs/experiments/comparative-query-decomposition.v1.json`; `docs/experiment-results/comparative-query-decomposition-v1-validation.json`; `docs/experiment-results/comparative-query-decomposition-v1-validation.md`; `docs/experiment-results/comparative-query-decomposition-v1-validation.csv`
- **Decision:** Select decomposed retrieval with a both-sides evidence gate. Compared with the balanced single-query baseline, it raises both-language coverage@4 from 0.6250 to 1.0000, both-evidence-side coverage from 0.2500 to 0.3750, evidence-side recall from 0.5000 to 0.6250, and side MRR from 0.3646 to 0.4271. The ungated decomposed variant has 0.5000 negative FPR; the gate reduces this to zero while rejecting no positives.
- **Limitations:** Subqueries are manually frozen rather than generated dynamically; The gate measures threshold eligibility rather than semantic entailment; Only eight positive and eight negative validation cases; Production behavior and the locked test remain untouched
- **Next step:** Benchmark an automatic deterministic or model-based subquery constructor against the frozen rewrites before integrating the selected gate into production.

## 17. Automatic comparative-query construction: comparative-subquery-constructor-v1

- **Research question:** Can a deterministic constructor replace manually frozen per-technology subqueries without reducing retrieval quality or abstention?
- **Status:** completed
- **Changed variable:** Manual subqueries versus focus-original and parsed-topic deterministic constructors
- **Controls:** Same 8 positive and 8 negative validation cases; both-sides gate; Gemini Embedding 2 at 1,024 dimensions; threshold 0.68; two chunks per technology; topK=4; no reranker; no LLM rewriting
- **Metrics:** Comparative no-answer FPR; positive gate rejections; both-language and canonical-evidence coverage@4; evidence-side recall and MRR; parse success; query length; cost
- **Artifacts:** `src/lib/rag/comparative-query.ts`; `scripts/test-comparative-query.ts`; `docs/experiments/comparative-subquery-constructor.v1.json`; `docs/experiment-results/comparative-subquery-constructor-v1-validation.json`; `docs/experiment-results/comparative-subquery-constructor-v1-validation.md`; `docs/experiment-results/comparative-subquery-constructor-v1-validation.csv`
- **Decision:** Select no deterministic constructor. Focus-original reduces both-language coverage to 0.7500, evidence-side recall to 0.4375, and introduces 0.1250 negative FPR. The parsed-topic template preserves 1.0000 both-language coverage, 0.3750 both-evidence coverage, 0.4271 side MRR, and zero FPR, but misses the 0.6250 recall floor at 0.5625 because it loses the Python evidence for the type-annotation case.
- **Limitations:** Parser coverage is limited to benchmarked comparative forms; Manual rewrites are a validation reference rather than a test oracle; The template was intentionally not tuned after observing its failure; Production and the locked test remain untouched
- **Next step:** Preregister a low-cost model-based subquery constructor against the same frozen reference and deterministic baseline, including rewrite validity, latency, token cost, and retrieval outcomes.

## 18. LLM-as-a-judge calibration: llm-judge-calibration-v1

- **Research question:** Can one low-cost independent LLM judge reproduce the existing human assessment of frozen RAG answers well enough to support later automatic evaluation?
- **Status:** failed
- **Changed variable:** Independent GPT-5.4 Nano judge at medium reasoning with one frozen rubric prompt
- **Controls:** 72 existing blinded human-reference rows; 48-row calibration and 24-row held-out audit split; frozen evidence; temperature 0; OpenAI provider pinned; OpenRouter fallbacks disabled
- **Metrics:** Pooled core quadratic weighted kappa; answerable quality Spearman correlation; binary pass agreement; per-dimension agreement; latency; tokens; cost
- **Artifacts:** `docs/experiments/llm-judge-calibration.v1.json`; `docs/evaluation/llm-judge-prompt.v1.json`; `docs/evaluation/llm-judge-split.v1.json`; `docs/experiment-results/llm-judge-calibration-v1-execution-failure.json`; `docs/experiment-results/llm-judge-calibration-v1-execution-failure.md`
- **Decision:** Stop before agreement analysis. The third response exposed an ambiguity in the single nullable JSON schema; two valid responses cost $0.0031475 and one additional request has unavailable usage. No human score was inspected for the repair.
- **Limitations:** Single quickly completed human reviewer; No inter-rater reliability estimate; Low score variance may destabilize correlation metrics; The internal audit is not the locked generation test
- **Next step:** Preregister a successor using separate answerable and unanswerable schemas, with every model and metric control unchanged.

## 19. LLM-as-a-judge calibration: llm-judge-calibration-v1.1

- **Research question:** Can GPT-5.4 Nano reproduce the human assessment when task-specific structured schemas remove the v1 ambiguity?
- **Status:** failed
- **Changed variable:** Answerability-specific response schema; every scientific and provider control remains identical to v1
- **Controls:** GPT-5.4 Nano medium; same rubric prompt text; same 48/24 split; same pass rule and thresholds; temperature 0; OpenAI provider pinned; fallbacks disabled
- **Metrics:** Pooled core quadratic weighted kappa; answerable quality Spearman correlation; binary pass agreement; per-dimension agreement; latency; tokens; cost
- **Artifacts:** `docs/experiments/llm-judge-calibration.v1.1.json`; `docs/evaluation/llm-judge-prompt.v1.json`; `docs/evaluation/llm-judge-split.v1.json`; `docs/experiment-results/llm-judge-calibration-v1.1-execution-ledger.json`; `docs/experiment-results/llm-judge-calibration-v1.1-validation.json`; `docs/experiment-results/llm-judge-calibration-v1.1-validation.md`; `docs/experiment-results/llm-judge-calibration-v1.1-disagreement-audit.csv`
- **Decision:** Do not select GPT-5.4 Nano prompt v1. Calibration QWK 0.4320 and Spearman 0.3570 missed their 0.60 and 0.70 floors, although pass agreement was 0.8333. Held-out audit QWK 0.1912, Spearman 0.4948, and pass agreement 0.7917 all failed. Abstention agreement was 1.0. Valid responses cost $0.046874; two provider responses without model identity were rejected.
- **Limitations:** Single quickly completed human reviewer; No inter-rater reliability estimate; Internal audit is not the locked test; v1 incurred a small separately recorded failed-attempt cost
- **Next step:** Complete secondary human review of the five audit disagreements and six sampled agreements before deciding whether the reference labels need correction or a separately preregistered stronger judge should be tested.

## 20. LLM judge reference adjudication: judge-human-adjudication-v1

- **Research question:** Are GPT-5.4 Nano disagreements caused by judge errors, noisy first-pass human labels, or insufficient frozen evidence?
- **Status:** completed
- **Changed variable:** Second time-separated review with blind scoring followed by explicit comparison and adjudication
- **Controls:** All 12 answerable held-out audit rows; three unique unanswerable controls; same frozen evidence; references hidden until every blind score is frozen; original human and judge artifacts immutable
- **Metrics:** Phase-one versus original-human agreement; phase-one versus judge agreement; label-change count; adjudication decision frequencies; evidence-ambiguity rate; recomputed cached judge agreement
- **Artifacts:** `docs/evaluation/llm-judge-human-adjudication.v1.json`; `docs/evaluation/JUDGE_ADJUDICATION_GUIDE_V1.md`; `docs/evaluation/llm-judge-human-adjudication-v1.completed.csv`; `docs/experiment-results/llm-judge-human-adjudication-v1-summary.json`; `docs/experiment-results/llm-judge-human-adjudication-v1-summary.md`; `src/app/evaluation/judge-adjudication/page.tsx`; `src/components/judge-adjudication-workbench.tsx`; `scripts/report-judge-human-adjudication.ts`
- **Decision:** Treat the completed review as a human-in-the-loop sensitivity analysis, not as an independent replacement gold standard. Fourteen of 15 decisions confirmed the new blind score and one answerable case was revised to the judge after comparison. Replacing the 12 answerable audit labels with the final adjudicated labels raises cached audit QWK from 0.1912 to 0.6407, Spearman from 0.4948 to 0.9214, and binary pass agreement from 0.7917 to 0.8750, crossing every frozen audit threshold without provider calls. GPT-5.4 Nano nevertheless remains ineligible because the unchanged calibration split still fails QWK and Spearman.
- **Limitations:** The same primary reviewer produced the original and time-separated adjudicated labels; The reviewer consulted Codex for case-by-case guidance, so this is AI-assisted human adjudication rather than independent human replication; Only three unique unanswerable controls are included because abstention agreement was already perfect; Reviewing the held-out audit consumes it for future prompt tuning
- **Next step:** Use these results as a documented reference-label sensitivity analysis; before selecting an automatic judge, either obtain a genuinely independent second-human review or preregister a stronger judge and evaluate it on a newly reserved untouched set.

## 21. LLM-as-a-judge calibration: llm-judge-calibration-v2

- **Research question:** Can GPT-5.4 Mini reproduce the existing human assessment reliably enough to justify evaluation on a newly reserved untouched audit set?
- **Status:** failed
- **Changed variable:** GPT-5.4 Mini replaces GPT-5.4 Nano; every prompt, schema, split, metric, threshold, reasoning, and routing control remains frozen
- **Controls:** 48 frozen calibration rows only; prompt v1; answerability-specific schemas; medium reasoning; temperature 0; OpenAI provider pinned; fallbacks disabled; old inspected audit inaccessible
- **Metrics:** Pooled core quadratic weighted kappa; answerable quality Spearman correlation; binary pass agreement; structured validity; provider errors; latency; tokens; cost
- **Artifacts:** `docs/experiments/llm-judge-calibration.v2.json`; `scripts/evaluate-llm-judge-mini.ts`; `docs/experiment-results/llm-judge-calibration-v2-execution-ledger.json`; `docs/experiment-results/llm-judge-calibration-v2-validation.json`; `docs/experiment-results/llm-judge-calibration-v2-validation.md`; `docs/experiment-results/llm-judge-calibration-v2-predictions.csv`
- **Decision:** Do not select GPT-5.4 Mini. It improved over Nano on every primary calibration metric: QWK 0.5975 versus 0.4320, Spearman 0.4893 versus 0.3570, and binary pass agreement 0.9375 versus 0.8333. It nevertheless missed the frozen QWK floor of 0.60 by 0.0025 and the Spearman floor of 0.70 materially. All 32 unique responses were valid, provider-pinned, and completed without errors for $0.110033. Per protocol, neither the old inspected audit nor the locked generation test was accessed.
- **Limitations:** Single human calibration reference; No independent relabeling of calibration rows; A calibration pass establishes audit eligibility rather than production validity
- **Next step:** Stop judge-model escalation for the current thesis and report Nano and Mini as negative but informative calibration results; keep automatic judging disabled.
