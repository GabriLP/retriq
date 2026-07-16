# Experimental matrix and decision register

Each row is a candidate configuration, including alternatives that fail or are rejected. A choice becomes a thesis conclusion only after controlled runs share the same corpus hash, golden-set hash, review-state filter, and evaluation protocol.

| Component | Alternatives to test | Controlled variables | Primary metrics | Current state |
|---|---|---|---|---|
| Chunking size | 300, 450, 850 target words | Same corpus/minimum words/absolute overlap/model/retrieval/evaluation | Recall@k, MRR, nDCG, chunk count, latency | Common full-corpus suite prepared; embedding preflight completed, retrieval runs pending |
| Chunk overlap | 0%, about 10%, about 20% | Same target size/model | Recall@k, duplicate-hit rate, indexed words, latency | Planned |
| Chunk boundary | Word window, heading-aware, semantic | Same target budget/model | Evidence hit rate, MRR, context coherence | Word window baseline implemented; alternatives planned |
| Embedding | Current Gemini baseline plus at least two supported alternatives | Same chunks/questions/task types/output dimensions/top-k | Recall@k, MRR, nDCG, latency, API requests, estimated tokens and cost | Persistent model-aware cache and dry-run estimator implemented; model shortlist must be verified before runs |
| Retrieval | Dense cosine, BM25, hybrid fusion | Same chunks/golden set/top-k | Recall@k, Precision@k, MRR, nDCG | Dense cosine implemented |
| Reranking | None, cross-encoder, LLM reranker | Same candidate pool and final k | nDCG, MRR, latency, cost | Planned |
| Threshold | Fixed score grid and validation-set tuning | Same model/top-k | No-answer false positives/negatives, recall | Baseline 0.18; sweep planned |
| Generator | Existing baseline plus two models | Frozen retrieved evidence | Key-fact coverage, groundedness, citations, latency, cost | Planned after retrieval benchmark |
| Judge | Disabled, judge model A/B, prompt variants | Human-labelled calibration subset | Agreement, confusion matrix, rank correlation | Foundation exists; calibration planned |
| Agent loop | Single pass, query rewrite, retrieve-check-retry | Same maximum budget and corpus | Success lift, iterations, latency, cost | Deferred until single-pass baselines are stable |

## Reporting rule

For every run, retain the hypothesis, complete configuration, source and dataset hashes, code fingerprint, environment, raw per-case outputs, aggregate metrics, failures, latency, and—where available—token/cost usage. Rejected alternatives remain in the registry with a reason; they are not deleted from the narrative.

## Common benchmark gate

`common-programming-chunk-size.v1.json` is the first shared protocol. Its validator rejects candidates that change any path other than `chunking.targetWords`, computes a protocol hash over the suite, experiment definitions, corpus manifests, and golden set, and records dataset readiness separately for exploratory and thesis use. Preparation also hashes the loaded document content so mutable HTML cannot silently differ across candidates. A valid configuration is not automatically thesis-ready: the current seed set has source-verified cases for only four language/domain groups and no human-approved cases.

## Preparation findings

| Date | Suite attempt | Observation | Consequence |
|---|---|---|---|
| 2026-07-15 | `20260715133756586` | All three candidates loaded corpus hash `e44495f8`; chunk count rose from 25,553 at target 850 to 30,455 at target 300, while indexed words rose from 4,789,743 to 5,288,888 because fixed overlap is repeated more often. | The preparation is comparable; index size and later embedding cost must be reported with retrieval quality. |
| 2026-07-15 | `20260715133756586` | Every candidate retained 17,861 chunks below the configured 200-word minimum because already-short source sections are emitted intact. Median chunk size ranged from 83 to 126 words. | Target size alone does not determine actual granularity; section-boundary behavior requires its own controlled alternative. |
| 2026-07-15 | `20260715133756586` | Maximum chunk size remained 5,952 words because a single oversized source block is not split by the current word-window implementation. | Keep this behavior as the measured baseline and add an oversized-block splitting strategy before accepting a chunking design. |
| 2026-07-15 | embedding preflight v1 (superseded) | With an empty cache, the 850/450/300 candidates estimated 25,119 / 27,061 / 30,018 unique inputs and 7,941,865 / 8,290,132 / 8,795,322 approximate input tokens. Exact duplicates avoided 447 / 448 / 450 inputs. | Retained as engineering history, but superseded because the provider-specific task format, explicit dimensionality, batching, and price assumption were not yet frozen. |
| 2026-07-16 | official provider review | Google lists `gemini-embedding-2` standard text input at USD 0.20 per million tokens and Batch API at USD 0.10; the model limit is 8,192 tokens per input. | The current synchronous runner records the standard price and batches independent inputs only to reduce HTTP requests. Async Batch API remains a separately priced execution alternative. |
| 2026-07-16 | embedding protocol v2 | The controlled suite now fixes 768 dimensions, 32 independent inputs per synchronous request, document formatting, and question-answering query formatting. Approximate maximum input size is 5,556 tokens, below the 8,192-token model limit. | Reprepare all runs from the committed protocol; old prepared runs and estimates are not inputs to the corrected comparison. Test 768/1536/3072 later as a separate axis. |
| 2026-07-16 | `20260716080048773` | The 850/450/300 candidates all reached Recall@4 and MRR 1.0. Precision rose from 0.5208 to 0.6875 to 0.7083; nDCG was 1.0 / 0.9933 / 1.0. | The 300-word candidate is the exploratory precision leader, but no chunk size is accepted until the dataset is expanded and threshold failure is addressed. |
| 2026-07-16 | `20260716080048773` | All three candidates produced no-answer false-positive rate 1.0 at threshold 0.18. | Threshold calibration is the next controlled retrieval experiment; the current fixed threshold is rejected as an abstention setting. |
| 2026-07-16 | `20260716080048773` | Ordered cache reuse reduced API inputs by 51.66% and estimated standard cost from USD 5.067176 to USD 3.424167, saving USD 1.643009. | Preserve execution order and preflight artifacts in cost comparisons. Cache affects cost and latency, not quality metrics. |

## Measurement corrections

| Date | Attempt | Finding | Disposition |
|---|---|---|---|
| 2026-07-14 | `20260714084248-gemini-embedding-2` | The initial nDCG implementation credited multiple chunks for the same single evidence target, producing the impossible value 1.2627. | Attempt retained but invalidated for comparison; evidence targets are now credited once and all rate/ranking metrics are checked to remain in [0, 1]. |
| 2026-07-15 | embedding task separation v1 | Earlier embedding calls did not declare whether an input was a document or a query, and one evaluator request mixed both input roles. | Initially corrected with request `taskType` values; subsequently superseded for `gemini-embedding-2`, which requires task instructions in the prompt instead. |
| 2026-07-16 | embedding task format v2 | Official documentation states that `gemini-embedding-2` does not support the legacy `taskType` request field. | Documents now use `title: ... | text: ...`; RAG questions use `task: question answering | query: ...`. Cache schema v2 prevents reuse of vectors created with the superseded format. |
