# Gemini 300-word baseline on benchmark v4 validation

## Scope and frozen inputs

- Parent run: `baseline-gemini-300-v4-validation/20260717084956473-e60c88ec`
- Preparation commit: `57368f9062d5e8e4ac9efa25d21e6b70c7fb17c7`
- Corpus: 33,079 chunks and 6,117,327 estimated words
- Benchmark: v4 validation only, 54 cases (27 answerable and 27 unanswerable)
- Embedding: Google `gemini-embedding-2`, 1,024 dimensions
- Chunking: 300 target words, 80-word overlap
- Retrieval: dense cosine, top-k 4
- Held-out test: not executed

## Cache and cost

The pre-run estimate found 30,019 unique cache hits and 2,656 cache misses across document and validation-query inputs. The missing inputs represented an estimated 1,356,120 provider tokens and **$0.271224** at the price recorded in the configuration.

The first short execution was externally interrupted after caching 672 inputs. The resumed execution embedded the remaining 1,984 inputs in 63 provider requests. A final cache-only execution reproduced the metrics with zero API inputs. Across the two provider-using executions, the total remains the pre-run estimate: 2,656 inputs, approximately 84 requests and $0.271224. These are planning estimates, not provider billing records.

## Dense baseline

At the exploratory minimum score of 0.18:

| Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR |
|---:|---:|---:|---:|---:|
| 0.9630 | 0.6296 | 0.9444 | 0.9493 | 1.0000 |

The only answerable miss was `python-parameter-kinds-001`: the top results came from the Python tutorial rather than the expected canonical Language Reference page. The result is semantically related but does not satisfy the page-specific evidence criterion.

## Threshold and metadata attempts

### Attempt v1 — failed as pre-registered

No dense or metadata-aware threshold satisfied all guardrails. Investigation showed that the metadata detector classified `C++` as `C`, excluding the relevant C++ document for two validation cases. This failed attempt is retained in `baseline-gemini-300-v4-metadata-filter-validation.md`.

### Attempt v2 — C++ detector correction

The regex correction was covered by a regression test and was the only intended algorithmic change. The thresholds and selection rule remained unchanged.

| Variant | Selected threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR |
|---|---:|---:|---:|---:|---:|---:|
| Dense cosine | none | — | — | — | — | — |
| Metadata-aware dense | **0.68** | **0.9630** | **0.6296** | **0.9444** | **0.9493** | **0.0000** |

The v2 result satisfies the pre-registered rule: zero false positives, Recall@4 at least 0.90 and MRR at least 0.85. Compared with the previous corpus calibration of 0.65, the expanded benchmark selects 0.68; therefore the threshold is corpus- and benchmark-dependent rather than universal.

## Decision

Use metadata-aware dense retrieval with threshold **0.68** as the current v4 validation choice. Do not execute the locked test until the remaining experiment families and human confirmations are complete.
