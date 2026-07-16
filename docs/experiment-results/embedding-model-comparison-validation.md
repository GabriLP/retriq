# Embedding model comparison on validation

- Corpus/chunks: frozen 300-word configuration
- Vector dimensions: **1024** for every model
- Retrieval: dense cosine, top-k 4
- Cases: **12 validation cases** (6 answerable + 6 verified negatives)
- Thresholds: calibrated independently without reducing each model's low-threshold Recall@4 or MRR
- Status: **exploratory**, not a held-out final result

| Model | Threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR | Score margin | Estimated list-price indexing cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemini Embedding 2 | 0.75 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 0.0000 | +0.0635 | $1.7816 |
| Voyage Code 3 | 0.60 | 0.9167 | 0.4306 | 0.7222 | 0.7292 | 0.0000 | +0.0273 | $1.5248* |
| OpenAI text-embedding-3-large | 0.18 | 1.0000 | 0.6250 | 0.8333 | 0.8636 | 1.0000 | -0.0097 | $1.1012 |
| OpenAI text-embedding-3-small | 0.18 | 0.8333 | 0.2917 | 0.6389 | 0.7003 | 1.0000 | -0.0781 | $0.1694 |

The score margin is the minimum top score for an answerable query minus the maximum top score for an unanswerable query. A positive margin means a single threshold can separate the two groups in this validation sample. A negative margin means their score ranges overlap.

Gemini is the current validation winner: it retrieves all expected evidence at rank one and cleanly separates answerable from unanswerable queries. Voyage is the only alternative that also reaches zero false positives without sacrificing its baseline retrieval metrics, but its ranking quality is lower. OpenAI Large retains full Recall@4 but cannot reject every negative query without losing answerable evidence; OpenAI Small is the cheapest and weakest candidate in this sample.

\* Voyage's list-price estimate is retained for comparison. The run should fall within the provider's free-token allowance if that allowance was unused, but billing data is not collected by the experiment runner.

## Operational observations

- Gemini resumed successfully from cache after the orchestration time limit.
- OpenAI Small first hit the account's 1,000,000 TPM limit; the failed attempt was retained and the run completed from cache with provider concurrency reduced to one.
- OpenAI Large completed with the same conservative concurrency.
- Voyage initially required a payment method to unlock standard rate limits, then completed with the free-token allowance still applicable.
- Full-index wall-clock latency is therefore not used to rank models in this round.

## Decision and next evidence needed

Retain Gemini Embedding 2 as the engineering baseline and Voyage Code 3 as the strongest alternative. Do not declare a thesis-level winner yet: expand and human-approve the benchmark, create a fresh untouched test split, freeze the selection rule, and evaluate that split once.
