# Retriq

Retriq is a bachelor thesis prototype for comparing AI-assisted technical
documentation interfaces with traditional documentation navigation. It uses a
small, inspectable retrieval-augmented generation pipeline and exposes both the
generated answer and the documentation chunks used as evidence.

## Local development

Create `.env.local` from `.env.example` and provide a Gemini API key:

```bash
GEMINI_API_KEY=your_api_key
```

Install dependencies and start the application:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Documentation corpus

The reproducible React documentation corpus is stored in
`docs/corpus/react-learn.json`. It contains Learn guides plus commonly used
React and React DOM API references, replacing the former small demo set.
Rebuild the local chunks and vector store after changing that manifest:

```bash
npm run ingest -- --manifest docs/corpus/react-learn.json
```

The generated `data/vector-store.json` remains versioned as a small, inspectable
React-only fallback. The expanded production corpus is stored in Neon
PostgreSQL with pgvector; intermediate chunks, embedding caches, database
credentials, and local evaluation logs remain ignored by Git.

The initial multi-language registry is `docs/corpus/programming-foundation.json`.
It declares publisher PDFs for C, Java, and PostgreSQL, and official HTML
sources where a maintained PDF is not available. Acquire its PDFs locally before
ingestion; originals and acquisition metadata remain outside Git:

```bash
npm run acquire -- --manifest docs/corpus/programming-foundation.json
npm run corpus:audit
npm run parse:corpus -- --manifest docs/corpus/programming-foundation.json
npm run ingest -- --manifest docs/corpus/programming-foundation.json
```

Large PDF conversions can be resumed safely. Completed artifacts are skipped only when their stored source hash still matches the acquired PDF:

```bash
npm run parse:corpus -- --manifest docs/corpus/programming-foundation.json --skip-complete
npm run parse:corpus -- --manifest docs/corpus/programming-foundation.json --source-id gnu-bash-5-3-reference-manual
```

`parse:corpus` persists each PDF as `document.md`, `document.docling.json`,
`normalized.json`, and `quality.json` under `data/parsed/<corpus>/<document>/`. Use
`--page-range 1-3` for a fast quality smoke test before converting full manuals.
Partial artifacts are rejected by ingestion. The corpus manifest also declares a
quality policy (`fail`, `skip`, or `allow`); `fail` is the safe default for
documents whose parser report requires review.

### Reproducible experiments

Version experiment definitions under `docs/experiments/`. Preparing a run does
not call an embedding or generation API: it snapshots configuration and corpus
hashes, records the Git/environment state, creates chunks, and writes an
append-only run under `data/experiments/`.

```bash
npm run experiment:prepare -- --config docs/experiments/react-baseline-word-850.json
npm run experiment:prepare -- --config docs/experiments/react-word-450.json
npm run experiment:compare
```

The common benchmark suite validates that every candidate uses the same corpus,
golden set, models, retrieval settings, and review-state filter. Its first axis
changes only `chunking.targetWords` across 850, 450, and 300 words. Validation
also writes a protocol hash over all controlled inputs and reports exploratory
versus thesis readiness.

```bash
npm run benchmark:validate
npm run benchmark:report
npm run benchmark:prepare
npm run benchmark:compare
```

`benchmark:prepare` does not call embedding or generation APIs. Run it from a
clean commit before thesis measurements so each prepared experiment records an
unambiguous code fingerprint. It also hashes the documents actually loaded by
each run and marks the suite invalid if remote HTML changed between candidates.

Evaluate retrieval from an immutable prepared run (the attempt and per-case outputs are stored beside that run):

```bash
npm run experiment:embedding:estimate -- --run data/experiments/<experiment>/<run>
npm run experiment:retrieval -- --run data/experiments/<experiment>/<run>
npm run experiment:retrieval:compare
```

Run a cache-only threshold diagnostic from the prepared 300-word candidate. The
command aborts instead of calling the provider if any required embedding is
missing:

```bash
npm run experiment:threshold:sweep -- --run data/experiments/common-programming-word-300/<run> --write-report
```

The estimate command never calls the provider. It reports unique texts, cache
hits and misses, avoided requests, and approximate input tokens before an
experiment can incur API usage. Set
`RETRIQ_EMBEDDING_PRICE_USD_PER_MILLION_TOKENS` to the documented provider
price assumed for that experiment; if it is omitted, Retriq deliberately leaves
the dollar estimate unavailable instead of inventing a price. Token estimates
use `RETRIQ_EMBEDDING_CHARACTERS_PER_TOKEN` (default 4) and are labelled as
approximations rather than billing data.

Embedding vectors are cached under `data/embedding-cache/` and reused across
ingestion and experiment runs. The cache identity includes provider, exact
model, task type, output dimensionality, and input hash. Documents use
`RETRIEVAL_DOCUMENT`; RAG questions use `QUESTION_ANSWERING`. For
`gemini-embedding-2`, these roles are encoded with Google's documented prompt
formats because that model does not accept the legacy `taskType` parameter.
Standard requests group up to 32 independent `Content` inputs to reduce HTTP
requests without changing the vectors or token price. Cache artifacts are local
and ignored by Git, while every estimate and retrieval attempt records cache,
input, provider-request, token, dimensionality, and cost fields alongside the
immutable run.

Validate the versioned evaluation cases and regenerate their thesis-friendly coverage report:

```bash
npm run golden:validate
npm run golden:report
```

Draft cases are tracked but excluded from scored benchmarks. Final thesis runs should use human-approved cases; exploratory runs may explicitly include source-verified cases.

Raw run artifacts stay outside Git. `experiment:compare` exports Markdown and
CSV tables to `docs/experiment-results/` for later inclusion in the thesis.

### PDFs with IBM Docling

PDFs are accepted as local sources and as direct `.pdf` URLs. They are converted
to structure-preserving Markdown by [IBM Docling](https://docling-project.github.io/docling/)
*during ingestion only*; the Next.js query runtime does not need Python or
Docling. Install the isolated ingestion dependency with Python 3.10+:

```bash
python -m pip install -r scripts/requirements-docling.txt
npm run ingest -- --source ./data/source/manual.pdf
```

Set `RETRIQ_DOCLING_PYTHON` when `python` is not the desired interpreter. PDF
images are intentionally not sent to the answer model yet; this pass preserves
their surrounding document structure for retrieval, while image understanding
can be added as a distinct multimodal stage later.

### LLM-as-a-judge

Each generated answer can be evaluated against its retrieved chunks using a
second Gemini call. The judge is disabled by default because it adds latency and
cost, and it is a measurement signal rather than a replacement for human
evaluation. Enable it locally with:

```bash
RETRIQ_LLM_JUDGE_ENABLED=true
RETRIQ_LLM_JUDGE_MODEL=gemini-3.5-flash
```

The API response and local evaluation log then include groundedness, citation
correctness, completeness, a verdict, and evidence gaps. A judge failure never
suppresses the original grounded answer.

## Vercel demo deployment

The selected production backend is exact pgvector search over the frozen
`baseline-gemini-300-v4-validation` run. Bootstrap and verify it with:

```bash
npx neonctl@latest init
npm run database:migrate
npm run database:import -- --batch-size 100 --activate
npm run database:inspect
npm run database:parity
```

`database:import` is resumable and cache-only: it refuses to call the embedding
provider when a frozen vector is missing. Corpus versions are content-hashed
and activated explicitly. Historical duplicate chunk IDs are preserved by
their frozen row ordinal instead of being silently removed.

Configure Vercel Production and Preview with `GEMINI_API_KEY`, a sensitive
pooled `DATABASE_URL`, and these non-secret values:

```bash
RETRIQ_VECTOR_STORE_BACKEND=postgres
GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY=1024
RETRIQ_MIN_SCORE=0.68
```

Exact cosine search intentionally has no approximate index. HNSW and IVFFlat
can only be enabled after a separately recorded recall, ranking, latency, and
storage comparison.

Do not enable `RETRIQ_EVALUATION_LOG_ENABLED` on Vercel. Production logging is
disabled by default because the serverless filesystem is not persistent.
