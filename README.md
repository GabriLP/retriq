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

The reproducible React Learn source list is stored in
`docs/corpus/react-learn.json`. Rebuild the local chunks and vector store after
changing that manifest:

```bash
npm run ingest -- --manifest docs/corpus/react-learn.json
```

The generated `data/vector-store.json` is versioned because both the production
build and the query API need it. Intermediate chunks and local evaluation logs
remain ignored by Git.

## Vercel demo deployment

Import the GitHub repository into Vercel, keep the detected Next.js build
settings, and add `GEMINI_API_KEY` to the project environment variables before
deploying.

Do not enable `RETRIQ_EVALUATION_LOG_ENABLED` on Vercel. Production logging is
disabled by default because the serverless filesystem is not persistent.
