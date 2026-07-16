import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

import { loadCorpusManifests } from "../src/lib/rag/corpus-manifest";
import type { EmbeddedChunk } from "../src/lib/rag/types";

type CliOptions = {
  sources: string[];
  manifests: string[];
  baseUrl?: string;
};

async function main() {
  nextEnv.loadEnvConfig(process.cwd());

  const [{ createChunksFromDocuments }, { ragConfig }, { loadSources }, { embedTexts }, { writeVectorStore }] =
    await Promise.all([
      import("../src/lib/rag/chunking"),
      import("../src/lib/rag/config"),
      import("../src/lib/rag/document-loaders"),
      import("../src/lib/rag/embeddings"),
      import("../src/lib/rag/vector-store"),
    ]);

  const options = parseArgs(process.argv.slice(2));
  const manifestOptions = await loadCorpusManifests(options.manifests);
  const sources = [...new Set([...manifestOptions.sources, ...options.sources])];
  const baseUrl = options.baseUrl ?? manifestOptions.baseUrl;

  if (!sources.length) printUsageAndExit();

  const documents = await loadSources(sources, { baseUrl, sourceMetadataByInput: manifestOptions.sourceMetadataByInput });
  const chunks = createChunksFromDocuments(documents);

  if (!chunks.length) {
    throw new Error("No chunks were produced. Check source paths or supported file extensions.");
  }

  // Embeddings are generated from title, section, and content together. This
  // gives the vector a small amount of structural context without hiding the
  // raw source fields used later for citations.
  const embeddings = await embedTexts(chunks.map((chunk) => `${chunk.section}\n${chunk.content}`), {
    taskType: "RETRIEVAL_DOCUMENT",
    concurrency: 4,
    titles: chunks.map((chunk) => chunk.title),
  });
  const embeddedChunks: EmbeddedChunk[] = chunks.map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index],
  }));

  await fs.mkdir(path.dirname(ragConfig.chunksPath), { recursive: true });
  await fs.writeFile(ragConfig.chunksPath, JSON.stringify(chunks, null, 2));
  await writeVectorStore(embeddedChunks);

  console.log(`Ingested ${documents.length} document sections into ${chunks.length} chunks.`);
  console.log(`Wrote ${ragConfig.chunksPath}`);
  console.log(`Wrote ${ragConfig.vectorStorePath}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { sources: [], manifests: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source" || arg === "-s") {
      const source = args[index + 1];
      if (!source) throw new Error("--source requires a path or URL.");
      options.sources.push(source);
      index += 1;
      continue;
    }

    if (arg === "--manifest" || arg === "-m") {
      const manifestPath = args[index + 1];
      if (!manifestPath) throw new Error("--manifest requires a JSON manifest path.");
      options.manifests.push(manifestPath);
      index += 1;
      continue;
    }

    if (arg === "--base-url") {
      options.baseUrl = args[index + 1];
      index += 1;
    }
  }

  return options;
}

function printUsageAndExit(): never {
  console.log(`Usage:
  npm run ingest -- --source ./data/source
  npm run ingest -- --source https://react.dev/learn/thinking-in-react
  npm run ingest -- --manifest ./docs/corpus/react-learn.json
  npm run ingest -- --source ./docs/react --base-url https://react.dev/reference`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
