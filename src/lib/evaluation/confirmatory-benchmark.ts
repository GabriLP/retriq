import type { GoldenCase } from "@/lib/rag/golden-set";

export type ConfirmatoryEvidence = {
  chunkId: string;
  sourceId: string | null;
  sourceUrl: string;
  title: string;
  section: string;
  pageStart?: number;
  pageEnd?: number;
  excerpt: string;
};

export type ConfirmatoryCase = GoldenCase & {
  evidencePacket: ConfirmatoryEvidence[];
  corpusCheck?: {
    checkedChunkCount: number;
    probes: Array<{ text: string; matches: number }>;
  };
};

export type ConfirmatoryBenchmark = {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  description: string;
  createdAt: string;
  status: "awaiting-human-confirmation" | "confirmed-locked";
  testLocked: boolean;
  method: string;
  corpus: {
    chunksFile: string;
    chunkCount: number;
    manifests: string[];
  };
  priorTestsExcluded: string[];
  counts: {
    total: number;
    answerable: number;
    unanswerable: number;
    domains: number;
  };
  cases: ConfirmatoryCase[];
  confirmation?: {
    reviewer: string;
    confirmedAt: string;
    sourceReviewFile: string;
    decision: "all-approved";
  };
};

export type BenchmarkApproval = {
  decision?: "approved" | "needs-correction";
  notes?: string;
  reviewedAt?: string;
};

export type ConfirmatoryPreAudit = {
  schemaVersion: 1;
  benchmarkId: string;
  benchmarkVersion: string;
  auditedAt: string;
  auditor: string;
  method: string;
  summary: {
    total: number;
    recommendedApprove: number;
    needsCorrection: number;
    highConfidence: number;
    authorSpotChecks: number;
  };
  entries: Array<{
    caseId: string;
    recommendation: "approve" | "needs-correction";
    confidence: "high" | "medium" | "low";
    authorSpotCheck: boolean;
    rationale: string;
    checks: string[];
  }>;
};

export function exportBenchmarkApprovalCsv(input: {
  benchmark: ConfirmatoryBenchmark;
  reviews: Record<string, BenchmarkApproval>;
  reviewer: string;
  exportedAt: string;
}) {
  const rows = [
    ["benchmark_id", "benchmark_version", "case_id", "language", "answerability", "decision", "notes", "reviewer", "reviewed_at", "exported_at"],
    ...input.benchmark.cases.map((item) => {
      const review = input.reviews[item.id] ?? {};
      return [
        input.benchmark.id,
        input.benchmark.version,
        item.id,
        item.language,
        item.answerability,
        review.decision ?? "",
        review.notes ?? "",
        input.reviewer,
        review.reviewedAt ?? "",
        input.exportedAt,
      ];
    }),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
