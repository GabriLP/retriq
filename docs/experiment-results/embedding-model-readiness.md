# Embedding model suite readiness

- Suite: `embedding-models-v1`
- Generated: 2026-07-16T15:00:06.892Z
- Controlled configuration: **valid**
- Common dimension: **1024**
- Dataset split: **validation only**
- Varied paths: `embedding.provider`, `embedding.model`, `embedding.pricing`
- Frozen areas: corpus, chunking, retrieval, evaluation, generation

| Provider | Model | Dimensions | USD / 1M input tokens | Price observed | Credential ready |
|---|---|---:|---:|---|---|
| google | gemini-embedding-2 | 1024 | 0.2 | 2026-07-16 | yes |
| openai | text-embedding-3-large | 1024 | 0.13 | 2026-07-16 | yes |
| openai | text-embedding-3-small | 1024 | 0.02 | 2026-07-16 | yes |
| voyage | voyage-code-3 | 1024 | 0.18 | 2026-07-16 | yes |

Prices are dated configuration inputs with a source URL retained in the JSON artifact. Credential readiness records only presence, never secret values. This report performs no provider calls. Each model must receive an independently calibrated validation threshold before quality comparisons; the previously observed test split must not be reused for model selection.
