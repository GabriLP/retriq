import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type ManifestSource = {
  id: string;
  type: "pdf" | "html" | "markdown";
  url?: string;
  path?: string;
  language?: string;
  license?: string;
  title?: string;
};

type CorpusManifest = {
  name?: string;
  sources: Array<string | ManifestSource>;
};

async function main() {
  const manifestPath = readManifestPath(process.argv.slice(2));
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifestPath);
  const manifest = JSON.parse(await fs.readFile(absoluteManifestPath, "utf8")) as CorpusManifest;

  if (!Array.isArray(manifest.sources)) throw new Error(`Corpus manifest ${manifestPath} must include a sources array.`);

  const pdfSources = manifest.sources.filter(isPdfSource);
  if (!pdfSources.length) {
    console.log("No PDF sources declared in the manifest.");
    return;
  }

  for (const source of pdfSources) {
    if (!source.url || !source.path) {
      throw new Error(`PDF source '${source.id}' must include both url and path for reproducible acquisition.`);
    }

    const targetPath = path.resolve(manifestDirectory, source.path);
    const metadataPath = `${targetPath}.metadata.json`;
    if (await exists(targetPath)) {
      console.log(`Skipped ${source.id}: ${targetPath} already exists.`);
      continue;
    }

    console.log(`Downloading ${source.id}…`);
    const response = await fetch(source.url, {
      headers: { "User-Agent": "Retriq corpus acquisition (research prototype)" },
    });
    if (!response.ok) throw new Error(`Could not download ${source.id}: ${response.status} ${response.statusText}`);

    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length) throw new Error(`Downloaded PDF '${source.id}' is empty.`);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content);
    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        {
          id: source.id,
          title: source.title,
          language: source.language,
          license: source.license,
          sourceUrl: source.url,
          downloadedAt: new Date().toISOString(),
          bytes: content.byteLength,
          sha256: crypto.createHash("sha256").update(content).digest("hex"),
          contentType: response.headers.get("content-type"),
        },
        null,
        2,
      ),
    );

    console.log(`Saved ${source.id}: ${content.byteLength.toLocaleString("en-US")} bytes.`);
  }
}

function isPdfSource(source: string | ManifestSource): source is ManifestSource {
  return typeof source !== "string" && source.type === "pdf";
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function readManifestPath(args: string[]) {
  const index = args.findIndex((arg) => arg === "--manifest" || arg === "-m");
  const manifestPath = index >= 0 ? args[index + 1] : undefined;
  if (!manifestPath) {
    throw new Error("Usage: tsx scripts/acquire-corpus.ts --manifest <manifest.json>");
  }
  return manifestPath;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
