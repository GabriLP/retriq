import fs from "node:fs/promises";
import path from "node:path";

export type GoldenCaseStatus = "draft" | "source-verified" | "human-approved" | "retired";
export type GoldenAnswerability = "answerable" | "unanswerable";
export type GoldenDifficulty = "easy" | "medium" | "hard";
export type GoldenQuestionType = "factual" | "procedural" | "comparative" | "multi-hop" | "unanswerable";
export type GoldenNegativeCategory = "out-of-corpus" | "adjacent-technology" | "vendor-specific" | "unsupported-version";
export type GoldenSplitName = "validation" | "test";

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
  negativeVerification?: {
    category: GoldenNegativeCategory;
    scopeBasis: string;
    absenceProbes: string[];
  };
  authoredBy: string;
  verifiedBy?: string;
  verifiedAt?: string;
  approval?: {
    state: "pending-confirmation" | "confirmed";
    approvedBy: string;
    approvedAt: string;
    basis: string;
  };
};

export type GoldenSetSplit = {
  schemaVersion: 1;
  id: string;
  version: string;
  datasetId: string;
  datasetVersion: string;
  createdAt: string;
  method: string;
  seed: string;
  eligibleStatuses: GoldenCaseStatus[];
  stratifyBy: string[];
  testLocked: boolean;
  validationCaseIds: string[];
  testCaseIds: string[];
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

export async function loadGoldenSetSplit(filePath: string): Promise<GoldenSetSplit> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as GoldenSetSplit;
}

export function selectGoldenSplit(dataset: Pick<GoldenSet, "cases">, split: GoldenSetSplit, name: GoldenSplitName) {
  const ids = new Set(name === "validation" ? split.validationCaseIds : split.testCaseIds);
  return dataset.cases.filter((testCase) => ids.has(testCase.id));
}

export function validateGoldenSetSplit(dataset: GoldenSet, split: GoldenSetSplit) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (split.schemaVersion !== 1) errors.push("Split schemaVersion must be 1.");
  if (split.datasetId !== dataset.id || split.datasetVersion !== dataset.version) {
    errors.push(`Split targets ${split.datasetId}@${split.datasetVersion}, expected ${dataset.id}@${dataset.version}.`);
  }
  if (!split.testLocked) warnings.push("Test split is not marked as locked.");
  const knownIds = new Set(dataset.cases.map((item) => item.id));
  const validationIds = new Set(split.validationCaseIds ?? []);
  const testIds = new Set(split.testCaseIds ?? []);
  const allListed = [...(split.validationCaseIds ?? []), ...(split.testCaseIds ?? [])];
  if (allListed.length !== new Set(allListed).size) errors.push("Cases must appear exactly once across validation and test splits.");
  for (const id of allListed) if (!knownIds.has(id)) errors.push(`Split references unknown case '${id}'.`);
  const eligible = dataset.cases.filter((item) => split.eligibleStatuses.includes(item.status));
  for (const item of eligible) {
    if (!validationIds.has(item.id) && !testIds.has(item.id)) errors.push(`Eligible case '${item.id}' is missing from both splits.`);
  }
  for (const name of ["validation", "test"] as const) {
    const selected = selectGoldenSplit(dataset, split, name);
    const answerable = selected.filter((item) => item.answerability === "answerable").length;
    const unanswerable = selected.length - answerable;
    if (!answerable || !unanswerable) errors.push(`${name} must contain answerable and unanswerable cases.`);
    if (answerable !== unanswerable) warnings.push(`${name} is not balanced: ${answerable} answerable, ${unanswerable} unanswerable.`);
  }
  return { errors, warnings };
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
      if (["source-verified", "human-approved"].includes(testCase.status)) {
        if (!testCase.negativeVerification?.scopeBasis?.trim()) errors.push(`${prefix}: verified unanswerable cases require a scope basis.`);
        if (!testCase.negativeVerification?.absenceProbes?.length) errors.push(`${prefix}: verified unanswerable cases require absence probes.`);
      }
    }

    if (["source-verified", "human-approved"].includes(testCase.status)) {
      if (!testCase.verifiedBy || !testCase.verifiedAt) {
        errors.push(`${prefix}: ${testCase.status} cases require verifiedBy and verifiedAt.`);
      }
    }
    if (testCase.status === "human-approved") {
      if (!testCase.approval?.approvedBy || !testCase.approval?.approvedAt || !testCase.approval?.basis) {
        errors.push(`${prefix}: human-approved cases require approval provenance.`);
      }
      if (testCase.approval?.state === "pending-confirmation") {
        warnings.push(`${prefix}: human approval is provisional and still requires independent confirmation.`);
      }
    }

    for (const evidence of testCase.evidence ?? []) {
      if (!evidence.sourceId && !evidence.sourceUrl) errors.push(`${prefix}: evidence requires sourceId or sourceUrl.`);
      if (evidence.sourceId && !catalog.ids.has(evidence.sourceId)) {
        errors.push(`${prefix}: unknown evidence sourceId '${evidence.sourceId}'.`);
      }
      if (evidence.sourceUrl && !catalog.urls.has(evidence.sourceUrl) && !evidence.sourceId) {
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
