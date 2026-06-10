import fs from "node:fs/promises";
import path from "node:path";

import { createChunksFromDocuments } from "../src/lib/rag/chunking";
import { ragConfig } from "../src/lib/rag/config";
import { loadSources } from "../src/lib/rag/document-loaders";
import { embedTexts } from "../src/lib/rag/embeddings";
import type { EmbeddedChunk } from "../src/lib/rag/types";
import { writeVectorStore } from "../src/lib/rag/vector-store";

type CliOptions = {
  sources: string[];
  baseUrl?: string;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.sources.length) printUsageAndExit();

  const documents = await loadSources(options.sources, { baseUrl: options.baseUrl });
  const chunks = createChunksFromDocuments(documents);

  if (!chunks.length) {
    throw new Error("No chunks were produced. Check source paths or supported file extensions.");
  }

  // Embeddings are generated from title, section, and content together. This
  // gives the vector a small amount of structural context without hiding the
  // raw source fields used later for citations.
  const embeddings = await embedTexts(chunks.map((chunk) => `${chunk.title}\n${chunk.section}\n${chunk.content}`));
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
  const options: CliOptions = { sources: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source" || arg === "-s") {
      const source = args[index + 1];
      if (!source) throw new Error("--source requires a path or URL.");
      options.sources.push(source);
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
  npm run ingest -- --source ./docs/react --base-url https://react.dev/reference`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
