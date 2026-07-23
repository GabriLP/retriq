import fs from "node:fs/promises";
import path from "node:path";

import { BenchmarkApprovalWorkbench } from "@/components/benchmark-approval-workbench";
import type { ConfirmatoryBenchmark, ConfirmatoryPreAudit } from "@/lib/evaluation/confirmatory-benchmark";

export const metadata = {
  title: "Confirmatory benchmark approval · Retriq",
  description: "Human confirmation of the fresh 48-case benchmark before final testing.",
};

export default async function ConfirmatoryBenchmarkReviewPage() {
  const [raw, preAuditRaw] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "docs/evaluation/confirmatory-benchmark.v1.review.json"), "utf8"),
    fs.readFile(path.join(process.cwd(), "docs/evaluation/confirmatory-benchmark.v1.pre-audit.json"), "utf8"),
  ]);
  const benchmark = JSON.parse(raw) as ConfirmatoryBenchmark;
  const preAudit = JSON.parse(preAuditRaw) as ConfirmatoryPreAudit;
  return <BenchmarkApprovalWorkbench benchmark={benchmark} preAudit={preAudit} />;
}
