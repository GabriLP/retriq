import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import matter from "gray-matter";

import type { SourceDocument, SourceType } from "./types";

const SUPPORTED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm", ".pdf", ".json"]);
const DOCLING_SCRIPT_PATH = path.join(process.cwd(), "scripts", "parse_pdf.py");
const MAX_DOCLING_OUTPUT_BYTES = Number(process.env.RETRIQ_DOCLING_MAX_OUTPUT_BYTES ?? 100 * 1024 * 1024);
const DOCLING_TIMEOUT_MS = Number(process.env.RETRIQ_DOCLING_TIMEOUT_MS ?? 15 * 60 * 1000);
const DOCLING_PAGE_RANGE = process.env.RETRIQ_DOCLING_PAGE_RANGE;

type ArtifactQualityPolicy = "fail" | "skip" | "allow";

type QualityException = {
  code: string;
  pageNumber: number;
  reason: string;
  verifiedAt: string;
  verificationMethod: string;
};

type SourceMetadata = {
  sourceId?: string;
  sourceUrl?: string;
  title?: string;
  sourceType?: SourceType;
  language?: string;
  version?: string;
  family?: string;
  documentRole?: string;
  authority?: string;
  stability?: string;
  publisher?: string;
  qualityPolicy?: ArtifactQualityPolicy;
  qualityExceptions?: QualityException[];
};

export async function loadSources(
  inputs: string[],
  options: { baseUrl?: string; sourceMetadataByInput?: Record<string, SourceMetadata> } = {},
) {
  const sources: SourceDocument[] = [];
  const pdfInputs: Array<{ input: string; sourceUrl: string; metadata?: SourceMetadata }> = [];

  for (const input of inputs) {
    const inputMetadata = options.sourceMetadataByInput?.[input];
    if (isUrl(input)) {
      if (isPdfUrl(input)) {
        pdfInputs.push({ input, sourceUrl: inputMetadata?.sourceUrl ?? input, metadata: inputMetadata });
      } else {
        sources.push(applySourceMetadata(await loadHtmlFromUrl(input), inputMetadata, "html"));
      }
      continue;
    }

    const absolutePath = path.resolve(input);
    // Accept either one file or a documentation folder so the same controlled
    // corpus can be ingested repeatedly across local runs.
    const stat = await fs.stat(absolutePath);
    const rootPath = stat.isDirectory() ? absolutePath : path.dirname(absolutePath);
    const files = stat.isDirectory() ? await collectFiles(absolutePath) : [absolutePath];

    for (const file of files) {
      const extension = path.extname(file).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) continue;
      // A manifest may point at a locally acquired HTML snapshot directory.
      // Child files inherit the source-level metadata unless explicitly overridden.
      const metadata = options.sourceMetadataByInput?.[path.resolve(file)] ?? inputMetadata;

      if (extension === ".md" || extension === ".mdx") {
        sources.push(...(await loadMarkdownFile(file, rootPath, options.baseUrl, metadata)));
      } else if (extension === ".pdf") {
        pdfInputs.push({
          input: file,
          sourceUrl: metadata?.sourceUrl ?? buildSourceUrl(file, rootPath, options.baseUrl),
          metadata,
        });
      } else if (extension === ".json") {
        if (path.basename(file) === "normalized.json") {
          sources.push(...(await loadNormalizedArtifact(file, metadata)));
        }
      } else {
        sources.push(await loadHtmlFile(file, rootPath, options.baseUrl, metadata));
      }
    }
  }

  if (pdfInputs.length) {
    const markdownByInput = await convertPdfsWithDocling(pdfInputs.map((pdf) => pdf.input));
    for (const pdf of pdfInputs) {
      const markdown = markdownByInput.get(pdf.input);
      if (!markdown) throw new Error(`Docling did not return content for ${pdf.input}.`);
      sources.push(createPdfDocument(markdown, pdf.sourceUrl, pdf.metadata));
    }
  }

  return sources;
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(fullPath) : Promise.resolve([fullPath]);
    }),
  );

  return files.flat();
}

async function loadMarkdownFile(
  filePath: string,
  rootPath: string,
  baseUrl?: string,
  metadata?: SourceMetadata,
): Promise<SourceDocument[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  // Frontmatter is useful for canonical titles/URLs, but it should not pollute
  // the text that later gets embedded and retrieved.
  const body = stripMdxSyntax(parsed.content);
  const title = String(parsed.data.title ?? metadata?.title ?? findFirstHeading(body) ?? path.basename(filePath));
  const sourceUrl = String(parsed.data.url ?? metadata?.sourceUrl ?? buildSourceUrl(filePath, rootPath, baseUrl));
  const sections = splitMarkdownIntoSections(body, title);

  // Section-level metadata is preserved before chunking so later retrieval can
  // cite a meaningful documentation location rather than an opaque text block.
  return sections.map((section) =>
    applySourceMetadata(
      { title, section: section.heading, content: section.content, sourceUrl },
      metadata,
      "markdown",
    ),
  );
}

async function loadHtmlFile(filePath: string, rootPath: string, baseUrl?: string, metadata?: SourceMetadata) {
  const html = await fs.readFile(filePath, "utf8");
  return applySourceMetadata(
    parseHtml(html, metadata?.sourceUrl ?? buildSourceUrl(filePath, rootPath, baseUrl)),
    metadata,
    "html",
  );
}

async function loadHtmlFromUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return parseHtml(await response.text(), url);
}

function parseHtml(html: string, sourceUrl: string): SourceDocument {
  const $ = cheerio.load(html);
  const canonicalUrl = resolveCanonicalUrl($("link[rel='canonical']").first().attr("href"), sourceUrl);
  // Navigation and decorative page chrome would create noisy embeddings, so the
  // loader keeps the main documentation text and removes unrelated UI content.
  $(
    "script, style, nav, footer, svg, noscript, button, [role='navigation'], .related, .sphinxsidebar, .sidebar, .mobile-nav",
  ).remove();

  const title = normalizeSourceText($("h1").first().text() || $("title").first().text() || sourceUrl);
  const main = $("[role='main'], main, article").first();
  const root = main.length ? main : $("body");
  const section = findPrimaryHtmlSection(root, title);
  const content = extractReadableHtmlText($, root);

  return {
    title,
    section,
    content,
    sourceUrl: canonicalUrl,
  };
}

function resolveCanonicalUrl(canonical: string | undefined, fallback: string) {
  if (!canonical) return fallback;
  try {
    return new URL(canonical, fallback).href;
  } catch {
    return fallback;
  }
}

function createPdfDocument(markdown: string, sourceUrl: string, metadata?: SourceMetadata): SourceDocument {
  const title = metadata?.title ?? findFirstHeading(markdown) ?? path.basename(sourceUrl.split("?")[0], ".pdf") ?? sourceUrl;

  return applySourceMetadata(
    {
      title: normalizeSourceText(title),
      section: normalizeSourceText(findFirstHeading(markdown) ?? "Document"),
      content: markdown,
      sourceUrl,
    },
    metadata,
    "pdf",
  );
}

async function loadNormalizedArtifact(filePath: string, metadata?: SourceMetadata): Promise<SourceDocument[]> {
  const artifact = JSON.parse(await fs.readFile(filePath, "utf8")) as {
    schemaVersion?: unknown;
    source?: unknown;
    sourceType?: unknown;
    qualityStatus?: unknown;
    partial?: unknown;
    qualityIssues?: unknown;
    pageRange?: unknown;
    sections?: Array<{
      heading?: unknown;
      pageStart?: unknown;
      pageEnd?: unknown;
      content?: unknown;
    }>;
  };

  if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.sections)) {
    throw new Error(`Unsupported normalized artifact schema: ${filePath}`);
  }
  if (artifact.partial === true) {
    throw new Error(
      `Refusing partial PDF artifact ${filePath}. Re-run npm run parse:corpus without --page-range before ingestion.`,
    );
  }

  const qualityIssues = normalizeQualityIssues(artifact.qualityIssues);
  const unresolvedQualityIssues = qualityIssues.filter(
    (issue) =>
      !metadata?.qualityExceptions?.some(
        (exception) => exception.code === issue.code && exception.pageNumber === issue.pageNumber,
      ),
  );
  const qualityStatus =
    artifact.qualityStatus === "review" && (!qualityIssues.length || unresolvedQualityIssues.length) ? "review" : "pass";
  const qualityPolicy = metadata?.qualityPolicy ?? "fail";
  if (qualityStatus === "review" && qualityPolicy === "fail") {
    throw new Error(`PDF artifact requires review and corpus qualityPolicy is 'fail': ${filePath}`);
  }
  if (qualityStatus === "review" && qualityPolicy === "skip") {
    console.warn(`Skipped PDF artifact requiring review: ${filePath}`);
    return [];
  }

  const sourceUrl = metadata?.sourceUrl ?? (typeof artifact.source === "string" ? artifact.source : `file://${filePath}`);
  const title = metadata?.title ?? path.basename(path.dirname(filePath));
  return artifact.sections.flatMap((section) => {
    if (typeof section.content !== "string" || !section.content.trim()) return [];
    return [
      applySourceMetadata(
        {
          title,
          section: typeof section.heading === "string" && section.heading.trim() ? section.heading.trim() : "Document",
          content: normalizeSourceText(section.content),
          sourceUrl,
          pageStart: typeof section.pageStart === "number" ? section.pageStart : undefined,
          pageEnd: typeof section.pageEnd === "number" ? section.pageEnd : undefined,
        },
        metadata,
        "pdf",
      ),
    ];
  });
}

function normalizeQualityIssues(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const candidate = issue as { code?: unknown; pageNumber?: unknown };
    if (typeof candidate.code !== "string" || typeof candidate.pageNumber !== "number") return [];
    return [{ code: candidate.code, pageNumber: candidate.pageNumber }];
  });
}

function applySourceMetadata(
  document: SourceDocument,
  metadata: SourceMetadata | undefined,
  fallbackType: SourceType,
): SourceDocument {
  return {
    ...document,
    title: metadata?.title ?? document.title,
    sourceUrl: metadata?.sourceUrl ?? document.sourceUrl,
    sourceId: metadata?.sourceId ?? document.sourceId,
    sourceType: metadata?.sourceType ?? fallbackType,
    language: metadata?.language ?? document.language,
    version: metadata?.version ?? document.version,
    family: metadata?.family ?? document.family,
    documentRole: metadata?.documentRole ?? document.documentRole,
    authority: metadata?.authority ?? document.authority,
    stability: metadata?.stability ?? document.stability,
    publisher: metadata?.publisher ?? document.publisher,
  };
}

async function convertPdfsWithDocling(inputs: string[]) {
  const python = process.env.RETRIQ_DOCLING_PYTHON ?? "python";
  const args = [DOCLING_SCRIPT_PATH];
  if (DOCLING_PAGE_RANGE) {
    args.push("--page-range", DOCLING_PAGE_RANGE);
  }
  args.push(...inputs);
  const output = await runProcess(python, args);

  let parsed: { documents?: Array<{ source?: unknown; markdown?: unknown }> };
  try {
    parsed = JSON.parse(output) as { documents?: Array<{ source?: unknown; markdown?: unknown }> };
  } catch {
    throw new Error("Docling did not return valid JSON while parsing the PDF.");
  }

  const markdownByInput = new Map<string, string>();
  for (const document of parsed.documents ?? []) {
    if (typeof document.source !== "string" || typeof document.markdown !== "string" || !document.markdown.trim()) continue;
    markdownByInput.set(document.source, normalizeSourceText(document.markdown));
  }

  return markdownByInput;
}

function runProcess(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, DOCLING_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
      if (Buffer.byteLength(stdout, "utf8") > MAX_DOCLING_OUTPUT_BYTES) child.kill();
    });
    child.stderr.on("data", (data: string) => {
      stderr += data;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Could not start Docling with '${command}'. Install it with 'python -m pip install -r scripts/requirements-docling.txt' or set RETRIQ_DOCLING_PYTHON. ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
        return;
      }

      const details = stderr.trim() || "No diagnostic output was returned.";
      const reason = timedOut
        ? `Docling exceeded the ${Math.round(DOCLING_TIMEOUT_MS / 1000)}s timeout`
        : `Docling failed to parse PDF (exit code ${code ?? "unknown"})`;
      reject(new Error(`${reason}: ${details}`));
    });
  });
}

function findPrimaryHtmlSection(root: cheerio.Cheerio<AnyNode>, fallback: string) {
  // A level-two heading normally identifies the page's first substantive
  // section, while earlier level-three headings often belong to callout boxes.
  const heading = root.find("h2").first().text() || root.find("h3").first().text();
  return normalizeSourceText(heading || fallback);
}

function extractReadableHtmlText($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>) {
  const blocks: string[] = [];

  root.find("h1, h2, h3, h4, p, li, pre").each((_, element) => {
    const node = $(element);
    const tagName = element.tagName?.toLowerCase();
    const text = normalizeSourceText(node.text());
    if (!text) return;

    if (tagName === "pre") {
      blocks.push(`\`\`\`\n${text}\n\`\`\``);
      return;
    }

    if (tagName === "li") {
      blocks.push(`- ${text}`);
      return;
    }

    if (/^h[1-4]$/.test(tagName ?? "")) {
      blocks.push(`${"#".repeat(Number(tagName?.[1] ?? 2))} ${text}`);
      return;
    }

    blocks.push(text);
  });

  return normalizeSourceText(blocks.join("\n\n"));
}

function splitMarkdownIntoSections(content: string, title: string) {
  const lines = content.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let heading = title;
  let buffer: string[] = [];

  for (const line of lines) {
    const match = /^(#{2,4})\s+(.+)$/.exec(line);
    if (match && buffer.join("\n").trim()) {
      // Heading-based sections are a lightweight semantic boundary. They are
      // not perfect, but they preserve author-provided documentation structure.
      sections.push({ heading, content: normalizeSourceText(buffer.join("\n")) });
      heading = match[2].trim();
      buffer = [line];
      continue;
    }

    if (match) heading = match[2].trim();
    buffer.push(line);
  }

  if (buffer.join("\n").trim()) {
    sections.push({ heading, content: normalizeSourceText(buffer.join("\n")) });
  }

  return sections.length ? sections : [{ heading: title, content: normalizeSourceText(content) }];
}

function stripMdxSyntax(content: string) {
  return content
    .replace(/^import .+$/gm, "")
    .replace(/^export .+$/gm, "")
    .replace(/<[^>]+>/g, " ");
}

function findFirstHeading(content: string) {
  return /^#{1,4}\s+(.+)$/m.exec(content)?.[1]?.trim();
}

function normalizeSourceText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function buildSourceUrl(filePath: string, rootPath: string, baseUrl?: string) {
  const relative = path.relative(rootPath, filePath).replaceAll(path.sep, "/");
  if (!baseUrl) {
    return `file://${filePath.replaceAll(path.sep, "/")}`;
  }

  return `${baseUrl.replace(/\/$/, "")}/${relative}`;
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isPdfUrl(value: string) {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}
