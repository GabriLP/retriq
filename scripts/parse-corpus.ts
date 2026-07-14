import { spawn } from "node:child_process";
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

  const pdfPaths = manifest.sources
    .filter((source): source is ManifestSource => typeof source !== "string" && source.type === "pdf")
    .map((source) => {
      if (!source.path) throw new Error(`PDF source '${source.id}' requires a local path. Run npm run acquire first.`);
      return path.resolve(manifestDirectory, source.path);
    });
  if (!pdfPaths.length) throw new Error("Corpus manifest does not declare any PDF sources.");

  for (const pdfPath of pdfPaths) {
    await fs.access(pdfPath).catch(() => {
      throw new Error(`Missing acquired PDF: ${pdfPath}. Run npm run acquire first.`);
    });
  }

  const outputDirectory = path.resolve(
    options.outputDirectory ?? path.join("data", "parsed", path.basename(manifestPath, path.extname(manifestPath))),
  );
  const python = process.env.RETRIQ_DOCLING_PYTHON ?? "python";
  const args = [path.resolve("scripts", "parse_pdf.py"), "--output-dir", outputDirectory];
  if (options.pageRange) args.push("--page-range", options.pageRange);
  args.push(...pdfPaths);

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

function parseArgs(args: string[]) {
  const manifestIndex = args.findIndex((arg) => arg === "--manifest" || arg === "-m");
  const outputIndex = args.findIndex((arg) => arg === "--output-dir");
  const pageRangeIndex = args.findIndex((arg) => arg === "--page-range");
  const manifest = manifestIndex >= 0 ? args[manifestIndex + 1] : undefined;
  if (!manifest) {
    throw new Error(
      "Usage: tsx scripts/parse-corpus.ts --manifest <manifest.json> [--page-range 1-3] [--output-dir path]",
    );
  }
  return {
    manifest,
    outputDirectory: outputIndex >= 0 ? args[outputIndex + 1] : undefined,
    pageRange: pageRangeIndex >= 0 ? args[pageRangeIndex + 1] : undefined,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
