import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import matter from "gray-matter";

import type { SourceDocument } from "./types";

const SUPPORTED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm", ".pdf"]);
const DOCLING_SCRIPT_PATH = path.join(process.cwd(), "scripts", "parse_pdf.py");
const MAX_DOCLING_OUTPUT_BYTES = 25 * 1024 * 1024;

export async function loadSources(inputs: string[], options: { baseUrl?: string } = {}) {
  const sources: SourceDocument[] = [];

  for (const input of inputs) {
    if (isUrl(input)) {
      sources.push(isPdfUrl(input) ? await loadPdf(input, input) : await loadHtmlFromUrl(input));
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

      if (extension === ".md" || extension === ".mdx") {
        sources.push(...(await loadMarkdownFile(file, rootPath, options.baseUrl)));
      } else if (extension === ".pdf") {
        sources.push(await loadPdf(file, buildSourceUrl(file, rootPath, options.baseUrl)));
      } else {
        sources.push(await loadHtmlFile(file, rootPath, options.baseUrl));
      }
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

async function loadMarkdownFile(filePath: string, rootPath: string, baseUrl?: string): Promise<SourceDocument[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  // Frontmatter is useful for canonical titles/URLs, but it should not pollute
  // the text that later gets embedded and retrieved.
  const body = stripMdxSyntax(parsed.content);
  const title = String(parsed.data.title ?? findFirstHeading(body) ?? path.basename(filePath));
  const sourceUrl = String(parsed.data.url ?? buildSourceUrl(filePath, rootPath, baseUrl));
  const sections = splitMarkdownIntoSections(body, title);

  // Section-level metadata is preserved before chunking so later retrieval can
  // cite a meaningful documentation location rather than an opaque text block.
  return sections.map((section) => ({
    title,
    section: section.heading,
    content: section.content,
    sourceUrl,
  }));
}

async function loadHtmlFile(filePath: string, rootPath: string, baseUrl?: string) {
  const html = await fs.readFile(filePath, "utf8");
  return parseHtml(html, buildSourceUrl(filePath, rootPath, baseUrl));
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
  // Navigation and decorative page chrome would create noisy embeddings, so the
  // loader keeps the main documentation text and removes unrelated UI content.
  $("script, style, nav, footer, svg, noscript, button").remove();

  const title = normalizeSourceText($("h1").first().text() || $("title").first().text() || sourceUrl);
  const main = $("main, article").first();
  const root = main.length ? main : $("body");
  const section = findPrimaryHtmlSection(root, title);
  const content = extractReadableHtmlText($, root);

  return {
    title,
    section,
    content,
    sourceUrl,
  };
}

async function loadPdf(input: string, sourceUrl: string): Promise<SourceDocument> {
  const markdown = await convertPdfWithDocling(input);
  const title = findFirstHeading(markdown) ?? path.basename(sourceUrl.split("?")[0], ".pdf") ?? sourceUrl;

  return {
    title: normalizeSourceText(title),
    section: normalizeSourceText(findFirstHeading(markdown) ?? "Document"),
    content: markdown,
    sourceUrl,
  };
}

async function convertPdfWithDocling(input: string) {
  const python = process.env.RETRIQ_DOCLING_PYTHON ?? "python";
  const output = await runProcess(python, [DOCLING_SCRIPT_PATH, input]);

  let parsed: { markdown?: unknown };
  try {
    parsed = JSON.parse(output) as { markdown?: unknown };
  } catch {
    throw new Error("Docling did not return valid JSON while parsing the PDF.");
  }

  if (typeof parsed.markdown !== "string" || !parsed.markdown.trim()) {
    throw new Error("Docling did not extract readable text from the PDF.");
  }

  return normalizeSourceText(parsed.markdown);
}

function runProcess(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";

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
      reject(
        new Error(
          `Could not start Docling with '${command}'. Install it with 'python -m pip install -r scripts/requirements-docling.txt' or set RETRIQ_DOCLING_PYTHON. ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      const details = stderr.trim() || "No diagnostic output was returned.";
      reject(new Error(`Docling failed to parse PDF (exit code ${code ?? "unknown"}): ${details}`));
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
  return /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
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
