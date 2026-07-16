# Common chunk-size retrieval analysis

Generated from benchmark suite attempt `20260716080048773` on 2026-07-16.
Protocol hash: `8e67ec583be2`. All three candidates use the same corpus snapshot,
`gemini-embedding-2`, 768 output dimensions, question-answering retrieval
instructions, cosine similarity, top-k 4, threshold 0.18, and the same 13
source-verified cases. These are exploratory results, not thesis-grade results.

## Retrieval quality

| Target words | Chunks | Recall@4 | Precision@4 | MRR | nDCG@4 | No-answer FPR |
|---:|---:|---:|---:|---:|---:|---:|
| 850 | 25,553 | 1.0000 | 0.5208 | 1.0000 | 1.0000 | 1.0000 |
| 450 | 27,496 | 1.0000 | 0.6875 | 1.0000 | 0.9933 | 1.0000 |
| 300 | 30,455 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 1.0000 |

The 300-word candidate has the best precision while retaining the observed
recall, MRR, and nDCG of the 850-word baseline. The 450-word candidate is close
but places one expected evidence target slightly lower, producing nDCG 0.9933.
This does not justify selecting 300 words yet: all candidates fail the single
unanswerable case at threshold 0.18, and the dataset lacks human-approved cases
and full language coverage.

## Marginal embedding usage in execution order

Execution order was 850, then 450, then 300 so later candidates could reuse the
persistent cache.

| Target words | Cache hits | New API inputs | Provider requests | Estimated input tokens | Marginal standard cost (USD) | Embedding time |
|---:|---:|---:|---:|---:|---:|---:|
| 850 | 0 | 25,119 | 786 | 8,036,225 | 1.607245 | 535.697 s |
| 450 | 22,073 | 4,988 | 156 | 3,821,759 | 0.764352 | 202.039 s |
| 300 | 20,392 | 9,626 | 301 | 5,262,853 | 1.052571 | 274.452 s |
| **Total** | **42,465** | **39,733** | **1,243** | **17,120,837** | **3.424167** | **1,012.188 s** |

At an empty-cache estimate for every candidate, the suite would require 82,198
API inputs, 2,572 provider requests, 25,335,882 approximate tokens, and USD
5.067176. Reusing the cache therefore avoided 42,465 API inputs (51.66%), 1,329
provider requests (51.67%), 8,215,045 approximate tokens, and USD 1.643009
(32.42%) under the standard-price assumption.

Costs use the Gemini Developer API standard text price of USD 0.20 per million
input tokens, observed on 2026-07-16 from
<https://ai.google.dev/gemini-api/docs/pricing>. They are engineering estimates
based on `ceil(characters / 4)`, not billing records. Free-tier usage could make
the actual charged amount lower. Google's asynchronous Batch API price was USD
0.10 per million tokens on the same date, but Batch execution was not used in
these runs and must be evaluated as a separate operational alternative.

## Next controlled experiment

Threshold calibration is the immediate priority because every chunk-size
candidate retrieved context for the unanswerable case. Run a fixed threshold
grid with cached embeddings, preserving chunk size and every other setting, and
measure the recall versus no-answer false-positive trade-off before accepting a
chunking candidate.
