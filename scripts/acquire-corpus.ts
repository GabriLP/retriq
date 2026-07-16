import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";

type ManifestSource = {
  id: string;
  type: "pdf" | "html" | "markdown";
  url?: string;
  path?: string;
  language?: string;
  license?: string;
  title?: string;
  crawl?: {
    includePattern?: string;
    excludePattern?: string;
    maxPages?: number;
  };
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
  const htmlSources = manifest.sources.filter(isHtmlSource);

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
    if (content.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error(
        `Downloaded source '${source.id}' is not a PDF (content-type: ${response.headers.get("content-type") ?? "unknown"}).`,
      );
    }

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

  for (const source of htmlSources) {
    await acquireHtmlSnapshot(source, manifestDirectory);
  }

  if (!pdfSources.length && !htmlSources.length) console.log("No remotely acquirable sources declared in the manifest.");
}

function isPdfSource(source: string | ManifestSource): source is ManifestSource {
  return typeof source !== "string" && source.type === "pdf";
}

function isHtmlSource(source: string | ManifestSource): source is ManifestSource {
  return typeof source !== "string" && source.type === "html" && Boolean(source.url && source.path);
}

async function acquireHtmlSnapshot(source: ManifestSource, manifestDirectory: string) {
  if (!source.url || !source.path) throw new Error(`HTML source '${source.id}' requires url and path.`);
  const targetDirectory = path.resolve(manifestDirectory, source.path);
  const include = source.crawl?.includePattern ? new RegExp(source.crawl.includePattern) : undefined;
  const exclude = source.crawl?.excludePattern ? new RegExp(source.crawl.excludePattern) : undefined;
  const maxPages = source.crawl?.maxPages ?? 1;
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error(`HTML source '${source.id}' has an invalid maxPages.`);

  const startUrl = normalizeCrawlUrl(source.url);
  const origin = new URL(startUrl).origin;
  const pending = [startUrl];
  const queued = new Set(pending);
  const pages: Array<{ url: string; file: string; bytes: number; sha256: string; contentType: string | null }> = [];
  await fs.mkdir(targetDirectory, { recursive: true });
  console.log(`Crawling ${source.id} (up to ${maxPages} pages)…`);

  while (pending.length && pages.length < maxPages) {
    const requestedUrl = pending.shift()!;
    const response = await fetch(requestedUrl, {
      headers: { "User-Agent": "Retriq corpus acquisition (research prototype)" },
    });
    if (!response.ok) throw new Error(`Could not download ${requestedUrl}: ${response.status} ${response.statusText}`);
    const finalUrl = normalizeCrawlUrl(response.url || requestedUrl);
    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.includes("text/html")) continue;
    const html = await response.text();
    const canonicalHtml = ensureCanonicalUrl(html, finalUrl);
    const file = `${crypto.createHash("sha256").update(finalUrl).digest("hex").slice(0, 16)}.html`;
    const content = Buffer.from(canonicalHtml, "utf8");
    await fs.writeFile(path.join(targetDirectory, file), content);
    pages.push({
      url: finalUrl,
      file,
      bytes: content.byteLength,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      contentType,
    });

    const $ = cheerio.load(html);
    const discovered = $("a[href]")
      .map((_, element) => $(element).attr("href"))
      .get()
      .flatMap((href) => {
        try {
          return [normalizeCrawlUrl(new URL(href, finalUrl).href)];
        } catch {
          return [];
        }
      })
      .filter((url) => {
        const parsed = new URL(url);
        return parsed.origin === origin && (!include || include.test(url)) && (!exclude || !exclude.test(url));
      })
      .sort();
    for (const url of discovered) {
      if (queued.has(url)) continue;
      queued.add(url);
      pending.push(url);
    }
  }

  const retainedFiles = new Set(pages.map((page) => page.file));
  for (const entry of await fs.readdir(targetDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html") || retainedFiles.has(entry.name)) continue;
    const stalePath = path.resolve(targetDirectory, entry.name);
    if (!stalePath.startsWith(`${targetDirectory}${path.sep}`)) throw new Error(`Unsafe stale HTML path: ${stalePath}`);
    await fs.rm(stalePath);
  }
  const snapshot = {
    schemaVersion: 1,
    id: source.id,
    sourceUrl: source.url,
    downloadedAt: new Date().toISOString(),
    crawl: { includePattern: source.crawl?.includePattern, excludePattern: source.crawl?.excludePattern, maxPages },
    pageCount: pages.length,
    pages,
    sha256: crypto.createHash("sha256").update(pages.map((page) => `${page.url}\0${page.sha256}`).join("\n")).digest("hex"),
  };
  await fs.writeFile(path.join(targetDirectory, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Saved ${source.id}: ${pages.length} HTML pages.`);
}

function normalizeCrawlUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function ensureCanonicalUrl(html: string, url: string) {
  const $ = cheerio.load(html);
  const canonical = $("link[rel='canonical']").first();
  if (canonical.length) canonical.attr("href", new URL(canonical.attr("href") ?? url, url).href);
  else $("head").append(`<link rel="canonical" href="${escapeHtmlAttribute(url)}">`);
  return $.html();
}

function escapeHtmlAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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
