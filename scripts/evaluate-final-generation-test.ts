import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

import { generateWithCandidate, type GeneratorCandidate, type GeneratorResult } from "../src/lib/rag/generator-providers";
import { loadGoldenSet, loadGoldenSetSplit, selectGoldenSplit, type GoldenCase } from "../src/lib/rag/golden-set";
import type { DocumentationChunk } from "../src/lib/rag/types";

type Protocol = {
  schemaVersion: 1; id: string; status: "preregistered" | "outputs-generated-awaiting-human-review" | "completed";
  lockedInputs: { retrievalResult: string; goldenSet: string; splitManifest: string; chunks: string; prompt: string; humanRubric: string; cases: number; answerableCases: number; unanswerableCases: number; expectedProviderCalls: number };
  candidate: GeneratorCandidate;
  generationControls: { temperature: number; maxOutputTokens: number; judgeEnabled: false };
  automaticChecks: { providerErrorsMaximum: number; providerOrModelMismatchesMaximum: number; explicitTruncationsMaximum: number; invalidCitationLabelRateMaximum: number; costCeilingUsd: number };
  integrity: Record<string, string>;
  plannedOutputs: { result: string; report: string; reviewWorksheet: string; executionLedger: string };
};
type Prompt = { schemaVersion: 1; id: string; systemInstructions: string[]; userTemplate: string; separator: string; noEvidencePolicy: { invokeGenerator: false; deterministicAnswer: string; answerStatus: string } };
type RetrievalCase = { caseId: string; answerability: "answerable" | "unanswerable"; rankedChunks: Array<{ rank: number; score: number; chunkId: string; relevant: boolean }> };
type RetrievalArtifact = { id: string; split: "test"; executionNumber: number; cases: RetrievalCase[] };
type Output = { caseId: string; answerability: string; generationPolicy: "invoke-generator" | "deterministic-abstention"; answer: string; answerStatus: string; evidenceCount: number; invalidCitationLabels: string[]; result: GeneratorResult | null; error: string | null };
type Ledger = { schemaVersion: 1; protocolId: string; startedAt: string; executionNumber: 1; protocolCommit: string | null; status: "running" | "technical-failure" | "completed"; outputs: Output[]; events: Array<{ at: string; type: string; caseId?: string; detail: string }> };

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const protocolPath = path.resolve(options.protocol);
  const protocolRaw = await fs.readFile(protocolPath, "utf8");
  const protocol = JSON.parse(protocolRaw) as Protocol;
  validateProtocol(protocol);
  const inputs = await loadInputs(protocol);
  const prepared = prepareCases(inputs.cases, inputs.retrieval, inputs.chunks, inputs.prompt);
  const generatedCount = prepared.filter((item) => item.evidence.length).length;
  if (generatedCount !== protocol.lockedInputs.expectedProviderCalls) throw new Error(`Expected ${protocol.lockedInputs.expectedProviderCalls} evidence-bearing cases, found ${generatedCount}.`);
  const estimate = estimateCost(prepared, protocol.candidate, protocol.generationControls.maxOutputTokens);
  if (options.plan) {
    console.log(`VALID PLAN ${protocol.id}: ${prepared.length} cases, ${generatedCount} provider calls, ${prepared.length - generatedCount} deterministic abstentions.`);
    console.log(`Conservative maximum cost: $${estimate.toFixed(6)}. No provider call or generation metric was produced.`);
    return;
  }
  if (!options.allowProviderRequests || !options.writeReport) throw new Error("Execution requires --allow-provider-requests and --write-report.");
  if (runCommand("git", ["diff", "--quiet"]) === null) throw new Error("Tracked changes must be committed before locked generation.");
  const ledgerPath = path.resolve(protocol.plannedOutputs.executionLedger);
  const ledger = await loadOrCreateLedger(ledgerPath, protocol, options.resume);
  if (ledger.status === "completed") throw new Error("The final generation test already completed and cannot be rerun.");
  const completed = new Map(ledger.outputs.filter((item) => !item.error).map((item) => [item.caseId, item]));

  for (const entry of prepared) {
    if (completed.has(entry.testCase.id)) continue;
    let output: Output;
    if (!entry.evidence.length) {
      output = { caseId: entry.testCase.id, answerability: entry.testCase.answerability, generationPolicy: "deterministic-abstention", answer: inputs.prompt.noEvidencePolicy.deterministicAnswer, answerStatus: inputs.prompt.noEvidencePolicy.answerStatus, evidenceCount: 0, invalidCitationLabels: [], result: null, error: null };
    } else {
      try {
        const result = await generateWithCandidate({ candidate: protocol.candidate, systemInstruction: inputs.prompt.systemInstructions.join("\n"), userPrompt: entry.userPrompt, temperature: protocol.generationControls.temperature, maxOutputTokens: protocol.generationControls.maxOutputTokens, allowProviderRequests: true });
        output = { caseId: entry.testCase.id, answerability: entry.testCase.answerability, generationPolicy: "invoke-generator", answer: result.answer, answerStatus: classify(result.answer), evidenceCount: entry.evidence.length, invalidCitationLabels: invalidLabels(result.answer, entry.evidence.length), result, error: null };
        ledger.events.push({ at: new Date().toISOString(), type: result.cacheHit ? "cache-hit" : "provider-success", caseId: entry.testCase.id, detail: `${result.responseModel}/${result.responseProvider}; finish=${result.finishReason ?? "unknown"}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output = { caseId: entry.testCase.id, answerability: entry.testCase.answerability, generationPolicy: "invoke-generator", answer: "", answerStatus: "error", evidenceCount: entry.evidence.length, invalidCitationLabels: [], result: null, error: message };
        ledger.status = "technical-failure";
        ledger.events.push({ at: new Date().toISOString(), type: "technical-failure", caseId: entry.testCase.id, detail: message });
      }
    }
    ledger.outputs = [...ledger.outputs.filter((item) => item.caseId !== output.caseId), output];
    await writeJson(ledgerPath, ledger);
    console.log(`${entry.testCase.id}: ${output.error ? "ERROR" : output.generationPolicy === "invoke-generator" ? "generated" : "deterministic"}`);
    if (output.error) throw new Error(`Technical failure recorded for ${output.caseId}; use --resume after the provider issue is resolved.`);
  }

  const orderedOutputs = prepared.map((item) => ledger.outputs.find((output) => output.caseId === item.testCase.id)!);
  const automatic = summarize(orderedOutputs, protocol);
  ledger.status = "completed";
  ledger.events.push({ at: new Date().toISOString(), type: "completed", detail: `Automatic checks ${automatic.allPassed ? "passed" : "failed"}; semantic quality awaits human review.` });
  await writeJson(ledgerPath, ledger);
  const artifact = { schemaVersion: 1, id: protocol.id, createdAt: new Date().toISOString(), split: "test", executionNumber: 1, candidate: protocol.candidate, controls: protocol.generationControls, estimate, automatic, outputs: orderedOutputs, provenance: { gitCommit: runCommand("git", ["rev-parse", "HEAD"]), protocolSha256: sha256(protocolRaw), retrievalResultSha256: protocol.integrity.retrievalResultSha256, benchmarkApprovalState: "pending-confirmation", independentlyHumanApproved: false }, decisionStatus: automatic.allPassed ? "automatic-checks-passed-human-review-required" : "automatic-checks-failed-human-review-still-required" };
  await writeFinalOutputs(protocol, artifact, prepared);
  console.log(`COMPLETED ${protocol.id}: automatic=${automatic.allPassed ? "PASS" : "FAIL"}, calls=${automatic.providerCalls}, cost=$${automatic.costUsd.toFixed(6)}, human review required.`);
}

async function loadInputs(protocol: Protocol) {
  const [retrievalRaw, promptRaw, rubricRaw, selectionRaw, chunksRaw] = await Promise.all([fs.readFile(path.resolve(protocol.lockedInputs.retrievalResult), "utf8"), fs.readFile(path.resolve(protocol.lockedInputs.prompt), "utf8"), fs.readFile(path.resolve(protocol.lockedInputs.humanRubric), "utf8"), fs.readFile(path.resolve("docs/experiments/generation-models.v1.json"), "utf8"), fs.readFile(path.resolve(protocol.lockedInputs.chunks), "utf8")]);
  const checks: Array<[string, string, string]> = [[retrievalRaw, protocol.integrity.retrievalResultSha256, "retrieval result"], [promptRaw, protocol.integrity.promptSha256, "prompt"], [rubricRaw, protocol.integrity.rubricSha256, "rubric"], [selectionRaw, protocol.integrity.selectionProtocolSha256, "selection protocol"], [chunksRaw, protocol.integrity.chunksSha256, "chunks"]];
  for (const [raw, expected, label] of checks) if (sha256(raw) !== expected) throw new Error(`Integrity mismatch for ${label}.`);
  const retrieval = JSON.parse(retrievalRaw) as RetrievalArtifact;
  if (retrieval.split !== "test" || retrieval.executionNumber !== 1) throw new Error("Generation requires the sole locked retrieval-test artifact.");
  const golden = await loadGoldenSet(protocol.lockedInputs.goldenSet);
  const split = await loadGoldenSetSplit(protocol.lockedInputs.splitManifest);
  const cases = selectGoldenSplit(golden, split, "test");
  if (cases.length !== protocol.lockedInputs.cases || cases.filter((item) => item.answerability === "answerable").length !== protocol.lockedInputs.answerableCases) throw new Error("Locked case counts changed.");
  return { retrieval, prompt: JSON.parse(promptRaw) as Prompt, chunks: JSON.parse(chunksRaw) as DocumentationChunk[], cases };
}

function prepareCases(cases: GoldenCase[], retrieval: RetrievalArtifact, chunks: DocumentationChunk[], prompt: Prompt) {
  const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const retrievalMap = new Map(retrieval.cases.map((item) => [item.caseId, item]));
  return cases.map((testCase) => {
    const retrieved = retrievalMap.get(testCase.id);
    if (!retrieved) throw new Error(`Missing retrieval output for ${testCase.id}.`);
    const evidence = retrieved.rankedChunks.map((ranked) => { const chunk = chunkMap.get(ranked.chunkId); if (!chunk) throw new Error(`Missing frozen chunk ${ranked.chunkId}.`); return { ranked, chunk, text: `[S${ranked.rank}]\nTitle: ${chunk.title}\nSection: ${chunk.section}\nURL: ${chunk.sourceUrl}\nContent:\n${chunk.content}` }; });
    const joined = evidence.map((item) => item.text).join(prompt.separator);
    return { testCase, evidence, userPrompt: prompt.userTemplate.replace("{{QUESTION}}", testCase.question).replace("{{EVIDENCE}}", joined || "No documentation excerpts supplied.") };
  });
}

function summarize(outputs: Output[], protocol: Protocol) {
  const generated = outputs.filter((item) => item.generationPolicy === "invoke-generator");
  const results = generated.flatMap((item) => item.result ? [item.result] : []);
  const costs = results.map((item) => item.usage.costUsd);
  const latency = results.map((item) => item.latencyMs).sort((a, b) => a - b);
  const checks = { providerErrors: outputs.filter((item) => item.error).length <= protocol.automaticChecks.providerErrorsMaximum, providerOrModelMismatches: results.filter((item) => item.responseModel !== protocol.candidate.expectedResponseModel || item.responseProvider !== protocol.candidate.expectedResponseProvider).length <= protocol.automaticChecks.providerOrModelMismatchesMaximum, explicitTruncations: results.filter((item) => item.truncated).length <= protocol.automaticChecks.explicitTruncationsMaximum, invalidCitationLabels: generated.filter((item) => item.invalidCitationLabels.length).length / Math.max(generated.length, 1) <= protocol.automaticChecks.invalidCitationLabelRateMaximum, costCeiling: sum(costs) <= protocol.automaticChecks.costCeilingUsd };
  return { cases: outputs.length, providerCalls: generated.length, deterministicAbstentions: outputs.length - generated.length, errors: outputs.filter((item) => item.error).length, truncations: results.filter((item) => item.truncated).length, invalidCitationLabelCases: generated.filter((item) => item.invalidCitationLabels.length).length, tokens: { prompt: sum(results.map((item) => item.usage.promptTokens)), completion: sum(results.map((item) => item.usage.completionTokens)), reasoning: sum(results.map((item) => item.usage.reasoningTokens)), total: sum(results.map((item) => item.usage.totalTokens)) }, costUsd: sum(costs), latencyMs: { median: percentile(latency, .5), p95: percentile(latency, .95) }, checks, allPassed: Object.values(checks).every(Boolean) };
}

async function writeFinalOutputs(protocol: Protocol, artifact: any, prepared: ReturnType<typeof prepareCases>) {
  for (const file of [protocol.plannedOutputs.result, protocol.plannedOutputs.report, protocol.plannedOutputs.reviewWorksheet]) if (await exists(path.resolve(file))) throw new Error(`Refusing to overwrite ${file}.`);
  await writeJson(path.resolve(protocol.plannedOutputs.result), artifact, true);
  await fs.writeFile(path.resolve(protocol.plannedOutputs.report), `# Final locked generation test\n\n- Candidate: **GLM-5.2 BaseTen FP8**\n- Split: **test, single execution**\n- Automatic checks: **${artifact.automatic.allPassed ? "PASS" : "FAIL"}**\n- Semantic quality: **pending required human review**\n- Provider calls: **${artifact.automatic.providerCalls}**; deterministic abstentions: **${artifact.automatic.deterministicAbstentions}**\n- Errors: **${artifact.automatic.errors}**; explicit truncations: **${artifact.automatic.truncations}**; invalid citation-label cases: **${artifact.automatic.invalidCitationLabelCases}**\n- Cost: **$${artifact.automatic.costUsd.toFixed(6)}**; median latency: **${artifact.automatic.latencyMs.median.toFixed(2)} ms**; p95: **${artifact.automatic.latencyMs.p95.toFixed(2)} ms**\n\nAutomatic reliability cannot establish groundedness, fact coverage, citation correctness, or semantic abstention. The dedicated 24-row human review must be completed before the thesis calls generation confirmed. The benchmark labels remain pending-confirmation and not independently human-approved.\n`, { flag: "wx" });
  const byCase = new Map(prepared.map((item) => [item.testCase.id, item]));
  const rows = artifact.outputs.map((output: Output) => { const entry = byCase.get(output.caseId)!; return [output.caseId, "selected-generator-hidden", output.answerability, entry.testCase.language, entry.testCase.question, entry.testCase.expected.keyFacts.join(" | "), entry.evidence.map((item) => item.text).join("\n\n---\n\n"), output.answer, "", "", "", "", "", "", "", "", "", "", ""]; });
  const header = ["case_id", "blind_variant_id", "answerability", "language", "question", "expected_key_facts", "frozen_evidence", "candidate_answer", "groundedness_0_4", "key_fact_coverage_0_4", "citation_correctness_0_4", "citation_completeness_0_4", "directness_0_2", "correct_abstention_0_1", "critical_unsupported_claim_0_1", "contradicts_evidence_0_1", "invalid_citation_label_0_1", "generator_failure_0_1", "reviewer_notes"];
  await fs.writeFile(path.resolve(protocol.plannedOutputs.reviewWorksheet), [header, ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n", { flag: "wx" });
}

async function loadOrCreateLedger(file: string, protocol: Protocol, resume: boolean) {
  if (await exists(file)) { const ledger = JSON.parse(await fs.readFile(file, "utf8")) as Ledger; if (!resume) throw new Error("An execution ledger exists; use --resume only for a recorded technical failure."); if (ledger.status !== "technical-failure") throw new Error(`Cannot resume ledger with status ${ledger.status}.`); ledger.status = "running"; ledger.events.push({ at: new Date().toISOString(), type: "resume", detail: "Cache-preserving technical recovery." }); return ledger; }
  if (resume) throw new Error("No failed ledger exists to resume.");
  const ledger: Ledger = { schemaVersion: 1, protocolId: protocol.id, startedAt: new Date().toISOString(), executionNumber: 1, protocolCommit: runCommand("git", ["rev-parse", "HEAD"]), status: "running", outputs: [], events: [{ at: new Date().toISOString(), type: "started", detail: "Single locked generation execution." }] };
  await writeJson(file, ledger);
  return ledger;
}

function validateProtocol(p: Protocol) { if (p.schemaVersion !== 1 || p.id !== "generation-final-test-v1" || p.status !== "preregistered" || p.generationControls.judgeEnabled || p.generationControls.maxOutputTokens !== 900 || p.candidate.id !== "glm-5.2-openrouter-baseten-fp8" || p.candidate.allowFallbacks !== false) throw new Error("Final generation protocol is not executable."); }
function invalidLabels(answer: string, count: number) { return [...new Set([...answer.matchAll(/\[S(\d+)\]/g)].map((match) => match[1]).filter((label) => Number(label) < 1 || Number(label) > count))]; }
function classify(answer: string) { return /cannot be fully determined|does not contain enough information|insufficient/i.test(answer) ? "insufficient_context" : "grounded"; }
function estimateCost(entries: ReturnType<typeof prepareCases>, candidate: GeneratorCandidate, maxTokens: number) { const generated = entries.filter((item) => item.evidence.length); const input = sum(generated.map((item) => Math.ceil(item.userPrompt.length / 4))); return input / 1e6 * candidate.inputPriceUsdPerMillionTokens + generated.length * maxTokens / 1e6 * candidate.outputPriceUsdPerMillionTokens; }
function parseArgs(args: string[]) { const i = args.indexOf("--protocol"); return { protocol: i >= 0 ? args[i + 1] : "docs/experiments/generation-final-test.v1.json", plan: args.includes("--plan"), allowProviderRequests: args.includes("--allow-provider-requests"), writeReport: args.includes("--write-report"), resume: args.includes("--resume") }; }
function runCommand(command: string, args: string[]) { const r = spawnSync(command, args, { encoding: "utf8", windowsHide: true }); return r.status === 0 ? r.stdout.trim() : null; }
async function writeJson(file: string, value: unknown, exclusive = false) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, exclusive ? { flag: "wx" } : undefined); }
async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function percentile(values: number[], fraction: number) { return values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] : 0; }
function csv(value: unknown) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

main().catch((error) => { console.error(error); process.exit(1); });
