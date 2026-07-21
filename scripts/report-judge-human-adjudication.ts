import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv, type ReviewCsvRow } from "../src/lib/evaluation/generation-review";
import { agreement, normalizedQuality, passesQuality, quadraticWeightedKappa, spearmanCorrelation, type JudgeLabel } from "../src/lib/evaluation/judge-metrics";

type Pair = { id: string; reference: JudgeLabel; predicted: JudgeLabel };
type Manifest = { selection: { rowIds: string[]; counts: { total: number; answerable: number; unanswerable: number } } };
const core = ["groundedness", "keyFactCoverage", "citationCorrectness", "citationCompleteness"] as const;

async function main() {
  const completedPath = path.resolve("docs/evaluation/llm-judge-human-adjudication-v1.completed.csv");
  const manifestPath = path.resolve("docs/evaluation/llm-judge-human-adjudication.v1.json");
  const auditPath = path.resolve("docs/experiment-results/llm-judge-calibration-v1.1-disagreement-audit.csv");
  const calibrationPath = path.resolve("docs/experiment-results/llm-judge-calibration-v1.1-validation.json");
  const outputBase = path.resolve("docs/experiment-results/llm-judge-human-adjudication-v1-summary");
  const [completedText, manifestText, auditText, calibrationText] = await Promise.all([
    fs.readFile(completedPath, "utf8"), fs.readFile(manifestPath, "utf8"), fs.readFile(auditPath, "utf8"), fs.readFile(calibrationPath, "utf8")
  ]);
  const completed = parseCsv(completedText).rows;
  const manifest = JSON.parse(manifestText) as Manifest;
  const audit = parseCsv(auditText).rows;
  const priorResult = JSON.parse(calibrationText) as { metrics: { calibration: { primary: Record<string, number> }; audit: { primary: Record<string, number> } } };
  validate(completed, manifest);

  const auditById = new Map(audit.map((row) => [row.row_id, row]));
  const selected = completed.map((row) => {
    const auditRow = auditById.get(row.row_id);
    if (!auditRow) throw new Error(`Missing audit row ${row.row_id}.`);
    return {
      id: row.row_id,
      answerability: row.answerability,
      phaseOne: labelFromPrefixed(row, "phase1"),
      final: labelFromPrefixed(row, "final"),
      original: labelFromCompact(auditRow, "human"),
      judge: labelFromCompact(auditRow, "judge"),
      decision: row.adjudication_decision,
      notes: row.adjudication_notes
    };
  });
  const finalById = new Map(selected.map((item) => [item.id, item.final]));
  const fullAuditPairs = audit.map((row) => ({
    id: row.row_id,
    reference: finalById.get(row.row_id) ?? labelFromCompact(row, "human"),
    predicted: labelFromCompact(row, "judge")
  }));
  const selectedPairs = (reference: "phaseOne" | "final" | "original", predicted: "judge" | "original") => selected.map((item) => ({ id: item.id, reference: item[reference], predicted: item[predicted] }));
  const decisions = frequencies(selected.map((item) => item.decision));
  const scoreChanges = selected.filter((item) => labelKey(item.phaseOne) !== labelKey(item.final));
  const artifact = {
    schemaVersion: 1,
    id: "llm-judge-human-adjudication-v1-summary",
    createdAt: new Date().toISOString(),
    sources: {
      completedReview: "docs/evaluation/llm-judge-human-adjudication-v1.completed.csv",
      completedReviewSha256: sha256(completedText),
      manifest: "docs/evaluation/llm-judge-human-adjudication.v1.json",
      manifestSha256: sha256(manifestText),
      originalJudgeAudit: "docs/experiment-results/llm-judge-calibration-v1.1-disagreement-audit.csv",
      originalJudgeAuditSha256: sha256(auditText)
    },
    review: {
      rows: selected.length,
      answerableRows: selected.filter((item) => item.answerability === "answerable").length,
      unanswerableRows: selected.filter((item) => item.answerability === "unanswerable").length,
      decisions,
      phaseOneToFinalChangedRows: scoreChanges.length,
      changedRowIds: scoreChanges.map((item) => item.id),
      completed: true,
      protocol: "Blind to stored human/judge references in phase one; reference comparison and explicit adjudication in phase two."
    },
    selectedSetAgreement: {
      originalHumanVsJudge: summarize(selectedPairs("original", "judge")),
      phaseOneVsJudge: summarize(selectedPairs("phaseOne", "judge")),
      finalVsJudge: summarize(selectedPairs("final", "judge")),
      phaseOneVsOriginalHuman: summarize(selectedPairs("phaseOne", "original")),
      finalVsOriginalHuman: summarize(selectedPairs("final", "original"))
    },
    recomputedFullAudit: {
      policy: "Replace all 12 answerable audit references with final adjudicated labels. Preserve the 12 original unanswerable rows; three unique cases were rechecked and all remained correct abstentions.",
      metrics: summarize(fullAuditPairs),
      originalMetrics: priorResult.metrics.audit.primary,
      providerRequests: 0,
      cacheRegenerationRequired: false
    },
    unchangedCalibration: {
      metrics: priorResult.metrics.calibration.primary,
      stillFailsFrozenThresholds: true
    },
    interpretation: {
      status: "sensitivity-analysis-not-independent-gold-standard",
      judgeEligibleForProduction: false,
      reason: "The adjudication is useful for correcting rubric interpretation and diagnosing evidence gaps, but it was performed by the same primary reviewer with conversational AI assistance. It cannot replace an independent second-human reference, and the unchanged calibration split still fails its frozen thresholds."
    },
    limitations: [
      "The same reviewer produced both the original labels and the time-separated adjudication.",
      "The reviewer consulted Codex for case-by-case scoring guidance during phase one; the result is human-in-the-loop and AI-assisted rather than an independent human replication.",
      "The held-out audit has now been inspected and must not be used to tune another judge prompt while still being described as held out.",
      "Only three unique unanswerable cases were rechecked because the original judge had perfect abstention agreement."
    ]
  };
  await fs.writeFile(`${outputBase}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.writeFile(`${outputBase}.md`, renderMarkdown(artifact));
  console.log(`VALID ${artifact.id}: ${selected.length} adjudicated rows, ${scoreChanges.length} phase-one-to-final change.`);
  console.log(`Recomputed full audit: QWK ${artifact.recomputedFullAudit.metrics.pooledCoreQuadraticWeightedKappa.toFixed(4)}, Spearman ${format(artifact.recomputedFullAudit.metrics.answerableQualitySpearman)}, pass agreement ${artifact.recomputedFullAudit.metrics.binaryPassAgreement.toFixed(4)}.`);
  console.log(`Wrote ${path.relative(process.cwd(), outputBase)}.{json,md}`);
}

function summarize(pairs: Pair[]) {
  const answerable = pairs.filter((pair) => pair.reference.answerability === "answerable");
  const referenceCore = answerable.flatMap((pair) => core.map((key) => pair.reference[key]!));
  const predictedCore = answerable.flatMap((pair) => core.map((key) => pair.predicted[key]!));
  return {
    rows: pairs.length,
    answerableRows: answerable.length,
    unanswerableRows: pairs.length - answerable.length,
    pooledCoreQuadraticWeightedKappa: quadraticWeightedKappa(referenceCore, predictedCore, 4),
    answerableQualitySpearman: spearmanCorrelation(answerable.map((pair) => normalizedQuality(pair.reference)), answerable.map((pair) => normalizedQuality(pair.predicted))),
    binaryPassAgreement: agreement(pairs.map((pair) => passesQuality(pair.reference)), pairs.map((pair) => passesQuality(pair.predicted))),
    exactLabelAgreement: agreement(pairs.map((pair) => labelKey(pair.reference) === labelKey(pair.predicted)), pairs.map(() => true)),
    meanReferenceQuality: average(answerable.map((pair) => normalizedQuality(pair.reference))),
    meanPredictedQuality: average(answerable.map((pair) => normalizedQuality(pair.predicted)))
  };
}

function validate(rows: ReviewCsvRow[], manifest: Manifest) {
  const errors: string[] = [];
  if (rows.length !== manifest.selection.counts.total) errors.push(`Expected ${manifest.selection.counts.total} rows, received ${rows.length}.`);
  const expected = new Set(manifest.selection.rowIds);
  const seen = new Set<string>();
  for (const row of rows) {
    if (!expected.has(row.row_id)) errors.push(`Unexpected row ${row.row_id}.`);
    if (seen.has(row.row_id)) errors.push(`Duplicate row ${row.row_id}.`);
    seen.add(row.row_id);
    if (row.review_status !== "adjudicated") errors.push(`${row.row_id}: review status is ${row.review_status}.`);
    if (!row.reviewer_id || !row.phase1_frozen_at || !row.exported_at) errors.push(`${row.row_id}: missing reviewer provenance.`);
    for (const prefix of ["phase1", "final"] as const) validateLabel(labelFromPrefixed(row, prefix), row.row_id, prefix, errors);
    if (!new Set(["confirm-independent", "revise-human", "revise-judge", "evidence-ambiguous"]).has(row.adjudication_decision)) errors.push(`${row.row_id}: invalid decision.`);
  }
  for (const id of expected) if (!seen.has(id)) errors.push(`Missing row ${id}.`);
  if (errors.length) throw new Error(errors.join("\n"));
}

function validateLabel(label: JudgeLabel, id: string, prefix: string, errors: string[]) {
  const values = label.answerability === "answerable"
    ? [[label.groundedness, 4], [label.keyFactCoverage, 4], [label.citationCorrectness, 4], [label.citationCompleteness, 4], [label.directness, 2]] as const
    : [[label.correctAbstention, 1]] as const;
  for (const [value, maximum] of values) if (!Number.isInteger(value) || value! < 0 || value! > maximum) errors.push(`${id}: invalid ${prefix} score ${value}.`);
  for (const value of [label.criticalUnsupportedClaim, label.contradictsEvidence, label.invalidCitationLabel, label.generatorFailure]) if (value !== 0 && value !== 1) errors.push(`${id}: invalid ${prefix} flag ${value}.`);
}

function labelFromPrefixed(row: ReviewCsvRow, prefix: "phase1" | "final"): JudgeLabel {
  const value = (column: string) => row[`${prefix}_${column}`] === "" ? null : Number(row[`${prefix}_${column}`]);
  return {
    answerability: row.answerability as JudgeLabel["answerability"],
    groundedness: value("groundedness_0_4"), keyFactCoverage: value("key_fact_coverage_0_4"),
    citationCorrectness: value("citation_correctness_0_4"), citationCompleteness: value("citation_completeness_0_4"),
    directness: value("directness_0_2"), correctAbstention: value("correct_abstention_0_1"),
    criticalUnsupportedClaim: value("critical_unsupported_claim_0_1")!, contradictsEvidence: value("contradicts_evidence_0_1")!,
    invalidCitationLabel: value("invalid_citation_label_0_1")!, generatorFailure: value("generator_failure_0_1")!
  };
}

function labelFromCompact(row: ReviewCsvRow, prefix: "human" | "judge"): JudgeLabel {
  const scoreParts = Object.fromEntries(row[`${prefix}_scores`].split("/").map((part) => [part.match(/^[A-Z]+/)?.[0], Number(part.match(/\d+$/)?.[0])]));
  const flagParts = Object.fromEntries(row[`${prefix}_flags`].split("/").map((part) => [part[0], Number(part.slice(1))]));
  const answerable = row.answerability === "answerable";
  return {
    answerability: answerable ? "answerable" : "unanswerable",
    groundedness: answerable ? scoreParts.G : null, keyFactCoverage: answerable ? scoreParts.K : null,
    citationCorrectness: answerable ? scoreParts.CC : null, citationCompleteness: answerable ? scoreParts.CP : null,
    directness: answerable ? scoreParts.D : null, correctAbstention: answerable ? null : scoreParts.A,
    criticalUnsupportedClaim: flagParts.U, contradictsEvidence: flagParts.C,
    invalidCitationLabel: flagParts.I, generatorFailure: flagParts.F
  };
}

function renderMarkdown(artifact: ReturnTypeArtifact) {
  const metrics = artifact.recomputedFullAudit.metrics;
  return `# Judge human adjudication v1\n\n- Completed rows: **${artifact.review.rows}** (${artifact.review.answerableRows} answerable, ${artifact.review.unanswerableRows} unanswerable)\n- Decisions: **${artifact.review.decisions["confirm-independent"] ?? 0}** confirmed independent, **${artifact.review.decisions["revise-judge"] ?? 0}** revised to judge\n- Phase-one-to-final score changes: **${artifact.review.phaseOneToFinalChangedRows}**\n- Provider requests: **0**\n\n## Agreement sensitivity\n\n| Reference on selected 15 | QWK | Quality Spearman | Pass agreement | Exact full-label agreement |\n|---|---:|---:|---:|---:|\n| Original human vs judge | ${row(artifact.selectedSetAgreement.originalHumanVsJudge)} |\n| New phase-one vs judge | ${row(artifact.selectedSetAgreement.phaseOneVsJudge)} |\n| Final adjudicated vs judge | ${row(artifact.selectedSetAgreement.finalVsJudge)} |\n\n## Recomputed 24-row audit\n\nAfter replacing the 12 answerable labels with their final adjudicated values and retaining the 12 original unanswerable rows:\n\n- Pooled core QWK: **${metrics.pooledCoreQuadraticWeightedKappa.toFixed(4)}**\n- Answerable quality Spearman: **${format(metrics.answerableQualitySpearman)}**\n- Binary pass agreement: **${metrics.binaryPassAgreement.toFixed(4)}**\n- Mean adjudicated quality: **${metrics.meanReferenceQuality.toFixed(4)}**\n- Mean judge quality: **${metrics.meanPredictedQuality.toFixed(4)}**\n\nThese are sensitivity-analysis metrics, not a replacement independent gold standard. GPT-5.4 Nano remains ineligible for production because the unchanged calibration split still fails the frozen QWK and Spearman thresholds.\n\n## Methodological limitation\n\nThe same reviewer produced the original and adjudicated labels and consulted Codex for case-by-case guidance during phase one. The result is therefore a useful human-in-the-loop error audit, but not an independent second-human replication. The audit has also now been inspected and cannot be reused as an untouched set for tuning another judge prompt.\n`;
}

type Summary = ReturnType<typeof summarize>;
type ReturnTypeArtifact = {
  review: { rows: number; answerableRows: number; unanswerableRows: number; decisions: Record<string, number>; phaseOneToFinalChangedRows: number };
  selectedSetAgreement: { originalHumanVsJudge: Summary; phaseOneVsJudge: Summary; finalVsJudge: Summary };
  recomputedFullAudit: { metrics: Summary };
};
function row(metrics: Summary) { return `${metrics.pooledCoreQuadraticWeightedKappa.toFixed(4)} | ${format(metrics.answerableQualitySpearman)} | ${metrics.binaryPassAgreement.toFixed(4)} | ${metrics.exactLabelAgreement.toFixed(4)}`; }
function labelKey(label: JudgeLabel) { return JSON.stringify(label); }
function frequencies(values: string[]) { return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length])); }
function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function format(value: number | null) { return value === null ? "n/a" : value.toFixed(4); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

main().catch((error) => { console.error(error); process.exit(1); });
