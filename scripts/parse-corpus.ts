import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type ManifestSource = {
  id: string;
  type: "pdf" | "html" | "markdown";
  path?: string;
};

type CorpusManifest = {
  sources: Array<string | ManifestSource>;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifest);
  const manifestDirectory = path.dirname(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as CorpusManifest;
  if (!Array.isArray(manifest.sources)) throw new Error("Corpus manifest must include a sources array.");

  const declaredPdfSources = manifest.sources.filter(
    (source): source is ManifestSource => typeof source !== "string" && source.type === "pdf",
  );
  const knownIds = new Set(declaredPdfSources.map((source) => source.id));
  for (const selectedId of options.sourceIds) {
    if (!knownIds.has(selectedId)) throw new Error(`Unknown PDF source id '${selectedId}'.`);
  }
  const selectedPdfSources = options.sourceIds.length
    ? declaredPdfSources.filter((source) => options.sourceIds.includes(source.id))
    : declaredPdfSources;
  let pdfSources = selectedPdfSources.map((source) => {
    if (!source.path) throw new Error(`PDF source '${source.id}' requires a local path. Run npm run acquire first.`);
    return { id: source.id, path: path.resolve(manifestDirectory, source.path) };
  });
  if (!pdfSources.length) throw new Error("No PDF sources were selected.");

  for (const source of pdfSources) {
    await fs.access(source.path).catch(() => {
      throw new Error(`Missing acquired PDF: ${source.path}. Run npm run acquire first.`);
    });
  }

  const outputDirectory = path.resolve(
    options.outputDirectory ?? path.join("data", "parsed", path.basename(manifestPath, path.extname(manifestPath))),
  );
  if (options.skipComplete && !options.pageRange) {
    const checks = await Promise.all(
      pdfSources.map(async (source) => ({
        source,
        complete: await isCompleteArtifact(outputDirectory, source.id, source.path),
      })),
    );
    for (const check of checks.filter((item) => item.complete)) console.log(`Skipped complete ${check.source.id}.`);
    pdfSources = checks.filter((item) => !item.complete).map((item) => item.source);
    if (!pdfSources.length) {
      console.log("All selected PDF artifacts are complete and match their source hashes.");
      return;
    }
  }

  const python = process.env.RETRIQ_DOCLING_PYTHON ?? "python";
  const args = [path.resolve("scripts", "parse_pdf.py"), "--output-dir", outputDirectory];
  if (options.pageRange) args.push("--page-range", options.pageRange);
  args.push(...pdfSources.map((source) => source.path));

  const output = await run(python, args);
  const result = JSON.parse(output) as {
    documents?: Array<{
      source: string;
      pageCount: number;
      elapsedMs: number;
      qualityStatus: string;
      qualityIssueCount: number;
      artifactDirectory: string;
    }>;
  };

  for (const document of result.documents ?? []) {
    console.log(
      `${path.basename(document.source)}: ${document.pageCount} page(s), ${document.qualityStatus}, ` +
        `${document.qualityIssueCount} issue(s), ${document.elapsedMs} ms`,
    );
  }
  console.log(`Wrote PDF artifacts to ${outputDirectory}`);
}

function run(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`PDF parsing exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function isCompleteArtifact(outputDirectory: string, sourceId: string, sourcePath: string) {
  try {
    const artifact = JSON.parse(
      await fs.readFile(path.join(outputDirectory, sourceId, "normalized.json"), "utf8"),
    ) as { partial?: unknown; sourceSha256?: unknown };
    if (artifact.partial !== false || typeof artifact.sourceSha256 !== "string") return false;
    const sourceHash = crypto.createHash("sha256").update(await fs.readFile(sourcePath)).digest("hex");
    return artifact.sourceSha256 === sourceHash;
  } catch {
    return false;
  }
}

function parseArgs(args: string[]) {
  const manifestIndex = args.findIndex((arg) => arg === "--manifest" || arg === "-m");
  const outputIndex = args.findIndex((arg) => arg === "--output-dir");
  const pageRangeIndex = args.findIndex((arg) => arg === "--page-range");
  const sourceIds = args.filter((arg, index) => args[index - 1] === "--source-id");
  const manifest = manifestIndex >= 0 ? args[manifestIndex + 1] : undefined;
  if (!manifest) {
    throw new Error(
      "Usage: tsx scripts/parse-corpus.ts --manifest <manifest.json> [--source-id id] [--skip-complete] [--page-range 1-3] [--output-dir path]",
    );
  }
  return {
    manifest,
    outputDirectory: outputIndex >= 0 ? args[outputIndex + 1] : undefined,
    pageRange: pageRangeIndex >= 0 ? args[pageRangeIndex + 1] : undefined,
    sourceIds,
    skipComplete: args.includes("--skip-complete"),
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
