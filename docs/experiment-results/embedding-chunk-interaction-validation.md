# Embedding model × chunk-size interaction

- Design: **2 models × 3 target chunk sizes**
- Models: Gemini Embedding 2 and Voyage Code 3
- Target sizes: 300, 450, and 850 words
- Fixed: corpus, 80-word overlap, 1024 dimensions, dense cosine, top-k 4, validation cases
- Cases: **12** (6 answerable + 6 verified negatives)
- Status: **exploratory**

| Model | Target words | Chunks | Threshold | Recall@4 | Precision@4 | MRR | nDCG@4 | FPR | Score margin | Fresh-index list-price estimate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemini Embedding 2 | 300 | 30,455 | 0.75 | 1.0000 | 0.7083 | 1.0000 | 1.0000 | 0.0000 | +0.0635 | $1.7844 |
| Gemini Embedding 2 | 450 | 27,496 | 0.75 | 1.0000 | 0.6250 | 1.0000 | 0.9795 | 0.0000 | +0.0554 | $1.6810 |
| Gemini Embedding 2 | 850 | 25,553 | 0.75 | 1.0000 | 0.5139 | 1.0000 | 1.0000 | 0.0000 | +0.0575 | $1.6099 |
| Voyage Code 3 | 300 | 30,455 | 0.60 | 0.9167 | 0.4306 | 0.7222 | 0.7292 | 0.0000 | +0.0273 | $1.5277* |
| Voyage Code 3 | 450 | 27,496 | 0.60 | 0.9167 | 0.4583 | 0.6944 | 0.7073 | 0.0000 | +0.0398 | $1.4419* |
| Voyage Code 3 | 850 | 25,553 | 0.60 | 0.9167 | 0.5139 | 0.6111 | 0.6781 | 0.0000 | +0.0306 | $1.3825* |

\* Voyage list prices are retained for comparison; the executed calls are expected to fall within the account's free-token allowance, which the runner cannot verify from billing data.

## Interpretation

Chunk size does influence the results, but it does not change the winning model in this sample:

- Gemini dominates Voyage at 300, 450, and 850 target words.
- Gemini keeps perfect Recall and MRR, but precision falls from 0.7083 to 0.5139 as chunks grow.
- Voyage keeps Recall stable, while MRR and nDCG deteriorate with larger chunks.
- Every cell can reach zero false positives after its own threshold calibration.
- Larger chunks reduce index size and estimated fresh-index cost, but the saving is modest relative to the loss in ranking precision.

The practical winner is **Gemini Embedding 2, 300 target words, threshold 0.75**. It has the highest precision and widest answerable/unanswerable score margin while tying for the best Recall, MRR, nDCG, and FPR.

## Important limitation

The nominal target grows from 300 to 850 words, but many documentation sections are shorter than all three targets. Consequently, chunk count falls from 30,455 to only 25,553 rather than proportionally. The experiment still detects a chunk-size effect, but the effective contrast is smaller than the configuration labels suggest. A later boundary/merging experiment should test whether short adjacent sections can be combined without damaging semantic coherence.

This is a validation result over twelve cases. It supports freezing the next engineering baseline, not a final thesis-wide generalization.
