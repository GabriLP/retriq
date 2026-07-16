import fs from "node:fs/promises";
import path from "node:path";

export type ArtifactQualityPolicy = "fail" | "skip" | "allow";

export type ManifestSource = {
  id: string;
  type?: "pdf" | "html" | "markdown";
  url?: string;
  path?: string;
  language?: string;
  version?: string;
  family?: string;
  documentRole?: string;
  authority?: string;
  stability?: string;
  publisher?: string;
  license?: string;
  title?: string;
  qualityExceptions?: QualityException[];
};

export type QualityException = {
  code: string;
  pageNumber: number;
  reason: string;
  verifiedAt: string;
  verificationMethod: string;
};

export type SourceMetadata = {
  sourceId?: string;
  sourceUrl?: string;
  title?: string;
  sourceType?: "pdf" | "html" | "markdown";
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

type CorpusManifest = {
  name?: string;
  description?: string;
  baseUrl?: string;
  parsedBasePath?: string;
  qualityPolicy?: ArtifactQualityPolicy;
  defaults?: Partial<ManifestSource>;
  sources: Array<string | ManifestSource>;
};

export async function loadCorpusManifests(manifestPaths: string[]) {
  const sources: string[] = [];
  const sourceMetadataByInput: Record<string, SourceMetadata> = {};
  const manifests: Array<{ path: string; name?: string; description?: string }> = [];
  let baseUrl: string | undefined;

  for (const manifestPath of manifestPaths) {
    const absolutePath = path.resolve(manifestPath);
    const manifestDirectory = path.dirname(absolutePath);
    const manifest = JSON.parse(await fs.readFile(absolutePath, "utf8")) as CorpusManifest;
    if (!Array.isArray(manifest.sources)) {
      throw new Error(`Corpus manifest ${manifestPath} must include a sources array.`);
    }

    manifests.push({ path: absolutePath, name: manifest.name, description: manifest.description });
    for (const source of manifest.sources) {
      const resolved = resolveManifestSource(
        source,
        manifestDirectory,
        manifest.parsedBasePath,
        manifest.qualityPolicy ?? "fail",
        manifest.defaults,
      );
      sources.push(resolved.input);
      if (resolved.metadata) sourceMetadataByInput[resolved.input] = resolved.metadata;
    }
    baseUrl ??= manifest.baseUrl;
  }

  return { sources: [...new Set(sources)], baseUrl, sourceMetadataByInput, manifests };
}

function resolveManifestSource(
  source: string | ManifestSource,
  manifestDirectory: string,
  parsedBasePath: string | undefined,
  qualityPolicy: ArtifactQualityPolicy,
  defaults: Partial<ManifestSource> | undefined,
) {
  if (typeof source === "string") {
    const input = resolvePathOrUrl(source, manifestDirectory);
    const metadata = defaults ? toSourceMetadata({ ...defaults, id: "", url: source }, qualityPolicy) : undefined;
    return { input, metadata };
  }
  source = { ...defaults, ...source };
  if (!source.id) throw new Error("Every structured corpus source requires an id.");

  const metadata = toSourceMetadata(source, qualityPolicy);
  if (source.type === "pdf" && parsedBasePath) {
    return {
      input: path.resolve(manifestDirectory, parsedBasePath, source.id, "normalized.json"),
      metadata,
    };
  }
  if (source.path) return { input: resolvePathOrUrl(source.path, manifestDirectory), metadata };
  if (source.url) return { input: source.url, metadata };
  throw new Error(`Corpus source '${source.id}' must include a path or url.`);
}

function toSourceMetadata(source: ManifestSource, qualityPolicy: ArtifactQualityPolicy): SourceMetadata {
  return {
    sourceId: source.id || undefined,
    sourceUrl: source.url,
    title: source.title,
    sourceType: source.type,
    language: source.language,
    version: source.version,
    family: source.family,
    documentRole: source.documentRole,
    authority: source.authority,
    stability: source.stability,
    publisher: source.publisher,
    qualityPolicy,
    qualityExceptions: source.qualityExceptions,
  };
}

function resolvePathOrUrl(source: string, manifestDirectory: string) {
  if (/^https?:\/\//i.test(source) || path.isAbsolute(source)) return source;
  return path.resolve(manifestDirectory, source);
}
