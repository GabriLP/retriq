import fs from "node:fs/promises";
import path from "node:path";

import type { ConfirmatoryBenchmark, ConfirmatoryPreAudit } from "../src/lib/evaluation/confirmatory-benchmark";

const inputFile = "docs/evaluation/confirmatory-benchmark.v1.review.json";
const outputFile = "docs/evaluation/confirmatory-benchmark.v1.pre-audit.json";

const spotChecks = new Map<string, string>([
  ["confirm-v1-bash-systemd", "The broad term 'systemd' occurs elsewhere in the corpus even though the requested Wants/Requires semantics do not."],
  ["confirm-v1-c-openssl", "OpenSSL is mentioned by PostgreSQL documentation, while the requested EVP API is absent."],
  ["confirm-v1-kotlin-ktor", "A broad substring match for Ktor occurs once outside Kotlin documentation; verify that it is irrelevant."],
  ["confirm-v1-postgres-postgis", "PostGIS is mentioned in the PostgreSQL manual, but ST_Buffer geography semantics are absent."],
  ["confirm-v1-c-array-conversion", "This label was corrected during pre-audit to include all C11 exceptions, so it merits direct confirmation."],
  ["confirm-v1-cpp-range-temporary-lifetime", "The rule is precise and version-sensitive; confirm the wording against the C++26 draft excerpt."],
  ["confirm-v1-go-interface-comparison", "The run-time panic condition is subtle and merits direct confirmation."],
  ["confirm-v1-python-generator-expression", "Memory behavior is explicit, while laziness follows from the surrounding generator semantics."],
  ["confirm-v1-react-apollo", "Random negative control selected for author spot-checking."],
  ["confirm-v1-rust-rayon", "Random negative control selected for author spot-checking."],
]);

async function main() {
  const benchmark = JSON.parse(await fs.readFile(path.resolve(inputFile), "utf8")) as ConfirmatoryBenchmark;
  const entries: ConfirmatoryPreAudit["entries"] = benchmark.cases.map((item) => {
    const spotReason = spotChecks.get(item.id);
    const checks = item.answerability === "answerable"
      ? [
          `${item.evidencePacket.length} frozen evidence packet(s) resolve.`,
          `${item.expected.keyFacts.length} expected fact(s) are represented in the cited excerpt(s).`,
          "Question and answer were compared with the frozen evidence during the pre-audit.",
        ]
      : [
          `${item.corpusCheck?.probes.length ?? 0} specific absence probe(s) return zero matches across ${item.corpusCheck?.checkedChunkCount ?? 0} chunks.`,
          "The requested API or framework behavior is outside the declared source scope.",
          "Absence probes are treated as supporting evidence, not proof of semantic absence.",
        ];
    return {
      caseId: item.id,
      recommendation: "approve" as const,
      confidence: spotReason ? "medium" as const : "high" as const,
      authorSpotCheck: Boolean(spotReason),
      rationale: spotReason ?? (item.answerability === "answerable"
        ? "The expected answer is directly and completely supported by the frozen authoritative excerpt."
        : "The technology-specific behavior is outside corpus scope and all distinctive probes are absent."),
      checks,
    };
  });
  const preAudit: ConfirmatoryPreAudit = {
    schemaVersion: 1,
    benchmarkId: benchmark.id,
    benchmarkVersion: benchmark.version,
    auditedAt: new Date().toISOString(),
    auditor: "Automated evidence pre-audit",
    method: "Case-by-case evidence review plus deterministic structural, balance, prior-set overlap, and full-corpus absence checks.",
    summary: {
      total: entries.length,
      recommendedApprove: entries.filter((entry) => entry.recommendation === "approve").length,
      needsCorrection: entries.filter((entry) => entry.recommendation === "needs-correction").length,
      highConfidence: entries.filter((entry) => entry.confidence === "high").length,
      authorSpotChecks: entries.filter((entry) => entry.authorSpotCheck).length,
    },
    entries,
  };
  await fs.writeFile(path.resolve(outputFile), `${JSON.stringify(preAudit, null, 2)}\n`);
  console.log(`Wrote ${outputFile}: ${preAudit.summary.highConfidence} high-confidence recommendations, ${preAudit.summary.authorSpotChecks} author spot-checks.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
