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

The generated `data/vector-store.json` is versioned because both the production
build and the query API need it. Intermediate chunks and local evaluation logs
remain ignored by Git.

The initial multi-language registry is `docs/corpus/programming-foundation.json`.
It declares publisher PDFs for C, Java, and PostgreSQL, and official HTML
sources where a maintained PDF is not available. Acquire its PDFs locally before
ingestion; originals and acquisition metadata remain outside Git:

```bash
npm run acquire -- --manifest docs/corpus/programming-foundation.json
npm run parse:corpus -- --manifest docs/corpus/programming-foundation.json
npm run ingest -- --manifest docs/corpus/programming-foundation.json
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

Import the GitHub repository into Vercel, keep the detected Next.js build
settings, and add `GEMINI_API_KEY` to the project environment variables before
deploying.

Do not enable `RETRIQ_EVALUATION_LOG_ENABLED` on Vercel. Production logging is
disabled by default because the serverless filesystem is not persistent.
