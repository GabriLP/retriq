import fs from "node:fs/promises";
import path from "node:path";

export type GoldenCaseStatus = "draft" | "source-verified" | "human-approved" | "retired";
export type GoldenAnswerability = "answerable" | "unanswerable";
export type GoldenDifficulty = "easy" | "medium" | "hard";
export type GoldenQuestionType = "factual" | "procedural" | "comparative" | "multi-hop" | "unanswerable";

export type GoldenEvidence = {
  sourceId?: string;
  sourceUrl?: string;
  pageStart?: number;
  pageEnd?: number;
  section?: string;
  note?: string;
};

export type GoldenCase = {
  id: string;
  status: GoldenCaseStatus;
  language: string;
  domain: string;
  question: string;
  answerability: GoldenAnswerability;
  difficulty: GoldenDifficulty;
  questionType: GoldenQuestionType;
  expected: {
    answer?: string;
    keyFacts: string[];
    refusalReason?: string;
  };
  evidence: GoldenEvidence[];
  tags?: string[];
  notes?: string;
  authoredBy: string;
  verifiedBy?: string;
  verifiedAt?: string;
};

export type GoldenSet = {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  description: string;
  createdAt: string;
  corpusManifests: string[];
  cases: GoldenCase[];
};

type CorpusManifest = {
  sources: Array<string | { id: string; url?: string }>;
};

export async function loadGoldenSet(filePath: string): Promise<GoldenSet> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as GoldenSet;
}

export async function validateGoldenSet(dataset: GoldenSet) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (dataset.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (!dataset.id || !dataset.version || !dataset.title) errors.push("id, version, and title are required.");
  if (!Array.isArray(dataset.corpusManifests) || !dataset.corpusManifests.length) {
    errors.push("corpusManifests must not be empty.");
  }
  if (!Array.isArray(dataset.cases) || !dataset.cases.length) errors.push("cases must not be empty.");

  const catalog = await loadSourceCatalog(dataset.corpusManifests ?? [], errors);
  const seenIds = new Set<string>();
  for (const testCase of dataset.cases ?? []) {
    const prefix = testCase.id ? `Case ${testCase.id}` : "Case without id";
    if (!testCase.id) errors.push(`${prefix}: id is required.`);
    if (seenIds.has(testCase.id)) errors.push(`${prefix}: duplicate id.`);
    seenIds.add(testCase.id);
    if (!testCase.question?.trim()) errors.push(`${prefix}: question is required.`);
    if (!testCase.language || !testCase.domain) errors.push(`${prefix}: language and domain are required.`);
    if (!testCase.authoredBy) errors.push(`${prefix}: authoredBy is required.`);
    if (!Array.isArray(testCase.expected?.keyFacts)) errors.push(`${prefix}: expected.keyFacts must be an array.`);

    if (testCase.answerability === "answerable") {
      if (!testCase.expected?.keyFacts?.length) errors.push(`${prefix}: answerable cases require key facts.`);
      if (testCase.status !== "draft" && !testCase.evidence?.length) {
        errors.push(`${prefix}: verified answerable cases require evidence.`);
      }
    } else {
      if (!testCase.expected?.refusalReason) errors.push(`${prefix}: unanswerable cases require a refusal reason.`);
      if (testCase.evidence?.length) errors.push(`${prefix}: unanswerable cases must not declare positive evidence.`);
    }

    if (["source-verified", "human-approved"].includes(testCase.status)) {
      if (!testCase.verifiedBy || !testCase.verifiedAt) {
        errors.push(`${prefix}: ${testCase.status} cases require verifiedBy and verifiedAt.`);
      }
    }

    for (const evidence of testCase.evidence ?? []) {
      if (!evidence.sourceId && !evidence.sourceUrl) errors.push(`${prefix}: evidence requires sourceId or sourceUrl.`);
      if (evidence.sourceId && !catalog.ids.has(evidence.sourceId)) {
        errors.push(`${prefix}: unknown evidence sourceId '${evidence.sourceId}'.`);
      }
      if (evidence.sourceUrl && !catalog.urls.has(evidence.sourceUrl)) {
        errors.push(`${prefix}: evidence URL is not present in a corpus manifest: ${evidence.sourceUrl}`);
      }
      if ((evidence.pageStart === undefined) !== (evidence.pageEnd === undefined)) {
        errors.push(`${prefix}: pageStart and pageEnd must be supplied together.`);
      }
      if (evidence.pageStart !== undefined && evidence.pageEnd !== undefined) {
        if (evidence.pageStart < 1 || evidence.pageEnd < evidence.pageStart) {
          errors.push(`${prefix}: invalid evidence page range ${evidence.pageStart}-${evidence.pageEnd}.`);
        }
      }
    }
    if (testCase.status === "draft") warnings.push(`${prefix}: draft cases are excluded from scored benchmarks.`);
  }

  return { errors, warnings };
}

async function loadSourceCatalog(manifestPaths: string[], errors: string[]) {
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const manifestPath of manifestPaths) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8")) as CorpusManifest;
      for (const source of manifest.sources ?? []) {
        if (typeof source === "string") urls.add(source);
        else {
          ids.add(source.id);
          if (source.url) urls.add(source.url);
        }
      }
    } catch (error) {
      errors.push(`Unable to read corpus manifest ${manifestPath}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return { ids, urls };
}
