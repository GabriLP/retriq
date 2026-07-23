"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Download, FileCheck2, RotateCcw, Save, SearchCheck, ShieldAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";

import {
  exportBenchmarkApprovalCsv,
  type BenchmarkApproval,
  type ConfirmatoryBenchmark,
  type ConfirmatoryPreAudit,
} from "@/lib/evaluation/confirmatory-benchmark";

const storageKey = "retriq:confirmatory-benchmark-v1-review:r3";

export function BenchmarkApprovalWorkbench({ benchmark, preAudit }: { benchmark: ConfirmatoryBenchmark; preAudit: ConfirmatoryPreAudit }) {
  const [reviewer, setReviewer] = useState("Gabriele");
  const [reviews, setReviews] = useState<Record<string, BenchmarkApproval>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const item = benchmark.cases[currentIndex];
  const review = reviews[item.id] ?? {};
  const completed = benchmark.cases.filter((testCase) => reviews[testCase.id]?.decision).length;
  const approved = benchmark.cases.filter((testCase) => reviews[testCase.id]?.decision === "approved").length;
  const ready = completed === benchmark.cases.length && reviewer.trim().length > 0;
  const domainCounts = useMemo(() => new Set(benchmark.cases.map((testCase) => testCase.domain)).size, [benchmark.cases]);
  const preAuditByCase = useMemo(() => new Map(preAudit.entries.map((entry) => [entry.caseId, entry])), [preAudit.entries]);
  const currentPreAudit = preAuditByCase.get(item.id);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
        reviewer?: string;
        reviews?: Record<string, BenchmarkApproval>;
        currentCaseId?: string;
      } | null;
      if (saved) {
        setReviewer(saved.reviewer || "Gabriele");
        setReviews(saved.reviews ?? {});
        const index = benchmark.cases.findIndex((testCase) => testCase.id === saved.currentCaseId);
        if (index >= 0) setCurrentIndex(index);
      }
    } finally {
      setHydrated(true);
    }
  }, [benchmark.cases]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(storageKey, JSON.stringify({
      reviewer,
      reviews,
      currentCaseId: item.id,
      savedAt: new Date().toISOString(),
    }));
  }, [hydrated, item.id, reviewer, reviews]);

  if (!hydrated) return <main className="grid min-h-screen place-items-center bg-[#f1ecdf] font-serif text-2xl">Ripristino revisione…</main>;

  function decide(decision: "approved" | "needs-correction") {
    setReviews((current) => ({
      ...current,
      [item.id]: { ...current[item.id], decision, reviewedAt: new Date().toISOString() },
    }));
  }

  function setNotes(notes: string) {
    setReviews((current) => ({ ...current, [item.id]: { ...current[item.id], notes } }));
  }

  function move(delta: number) {
    setCurrentIndex((value) => Math.max(0, Math.min(benchmark.cases.length - 1, value + delta)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportCsv() {
    if (!ready) return;
    download("confirmatory-benchmark-v1-human-review.completed.csv", exportBenchmarkApprovalCsv({
      benchmark,
      reviews,
      reviewer: reviewer.trim(),
      exportedAt: new Date().toISOString(),
    }), "text/csv;charset=utf-8");
  }

  function backup() {
    download("confirmatory-benchmark-v1-human-review.progress.json", `${JSON.stringify({
      schemaVersion: 1,
      benchmarkId: benchmark.id,
      benchmarkVersion: benchmark.version,
      reviewer,
      reviews,
      exportedAt: new Date().toISOString(),
    }, null, 2)}\n`, "application/json");
  }

  function reset() {
    if (!window.confirm("Eliminare tutti i giudizi salvati localmente per questi 48 casi?")) return;
    localStorage.removeItem(storageKey);
    setReviews({});
    setCurrentIndex(0);
  }

  function applyHighConfidenceRecommendations() {
    if (!window.confirm(`Confermare in blocco i ${preAudit.summary.highConfidence} casi con pre-audit ad alta confidenza? I ${preAudit.summary.authorSpotChecks} casi di controllo resteranno da valutare singolarmente.`)) return;
    const reviewedAt = new Date().toISOString();
    setReviews((current) => {
      const next = { ...current };
      for (const entry of preAudit.entries) {
        if (entry.confidence === "high" && entry.recommendation === "approve" && !next[entry.caseId]?.decision) {
          next[entry.caseId] = { ...next[entry.caseId], decision: "approved", reviewedAt };
        }
      }
      return next;
    });
  }

  return <main className="min-h-screen bg-[#f1ecdf] text-[#171815]">
    <header className="sticky top-0 z-30 border-b border-black/15 bg-[#f1ecdf]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-5 px-5 py-4 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-[#2457d6] text-white"><SearchCheck className="size-5" /></span>
          <div><p className="font-mono text-[9px] uppercase tracking-[.24em] text-[#2457d6]">Retriq · confirmatory test</p><h1 className="font-serif text-xl font-semibold">Benchmark approval desk</h1></div>
        </div>
        <div className="flex min-w-[300px] flex-1 items-center gap-3 lg:ml-8">
          <span className="font-mono text-[10px] uppercase tracking-widest text-black/45">Conferma</span>
          <div className="h-1.5 flex-1 bg-black/10"><div className="h-full bg-[#2457d6]" style={{ width: `${completed / benchmark.cases.length * 100}%` }} /></div>
          <span className="font-mono text-xs">{completed}/{benchmark.cases.length}</span>
        </div>
        <span className="flex items-center gap-2 text-xs text-black/45"><Save className="size-3.5" />Autosave locale</span>
      </div>
    </header>

    <div className="mx-auto grid max-w-[1680px] lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="border-r border-black/15 p-5 lg:min-h-[calc(100vh-77px)] lg:p-7">
        <label className="font-mono text-[9px] uppercase tracking-[.2em] text-black/40">Revisore</label>
        <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} className="w-full border-b border-black/20 bg-transparent py-2 font-serif text-xl outline-none focus:border-[#2457d6]" />
        <div className="mt-6 grid grid-cols-3 border border-black/10 bg-white/40 text-center">
          <Metric value={benchmark.counts.total} label="casi" />
          <Metric value={domainCounts} label="domini" />
          <Metric value={approved} label="approvati" />
        </div>
        <p className="mt-7 font-mono text-[9px] uppercase tracking-[.2em] text-black/40">Dossier</p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {benchmark.cases.map((testCase, index) => {
            const decision = reviews[testCase.id]?.decision;
            return <button type="button" key={testCase.id} title={`${testCase.language}: ${testCase.question}`} onClick={() => setCurrentIndex(index)} className={`aspect-square border font-mono text-xs transition ${index === currentIndex ? "border-[#2457d6] bg-[#2457d6] text-white" : decision === "approved" ? "border-[#1e5949] bg-[#1e5949] text-white" : decision === "needs-correction" ? "border-[#b93927] bg-[#b93927] text-white" : "border-black/15 bg-white/45 hover:border-black/50"}`}>{index + 1}</button>;
          })}
        </div>
        <div className="mt-6 border-l-2 border-[#2457d6] bg-white/45 p-4 text-xs leading-5 text-black/65">
          <strong className="text-black/85">Cosa stai approvando?</strong><br />
          La domanda, la risposta attesa e la sua prova nel corpus. Per i negativi, confermi invece che la domanda è fuori dal perimetro documentale.
        </div>
        <div className="mt-4 border border-black/10 bg-[#fbf8f0] p-4 text-xs leading-5">
          <p className="font-mono text-[9px] uppercase tracking-[.18em] text-[#2457d6]">Pre-audit completato</p>
          <p className="mt-2 text-black/65"><strong className="text-black/85">{preAudit.summary.highConfidence}</strong> casi ad alta confidenza; <strong className="text-black/85">{preAudit.summary.authorSpotChecks}</strong> controlli personali consigliati.</p>
          <button type="button" onClick={applyHighConfidenceRecommendations} className="mt-3 w-full border border-[#2457d6] px-3 py-2 text-[#2457d6] transition hover:bg-[#2457d6] hover:text-white">Conferma i {preAudit.summary.highConfidence} casi prevalidati</button>
        </div>
        <div className="mt-5 space-y-2">
          <button type="button" disabled={!ready} onClick={exportCsv} className="flex w-full items-center justify-center gap-2 bg-[#171815] px-3 py-3 text-sm text-white disabled:opacity-25"><Download className="size-4" />Esporta revisione completa</button>
          <SideButton onClick={backup} icon={Save}>Backup progresso</SideButton>
          <SideButton onClick={reset} icon={RotateCcw} muted>Azzera revisione</SideButton>
        </div>
      </aside>

      <section className="min-w-0 p-5 lg:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-black/15 pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[.18em] text-black/45">{String(currentIndex + 1).padStart(2, "0")}/48 · {item.language} · {item.answerability}</p>
          <span className="border border-[#b93927]/25 bg-[#b93927]/5 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-[#9d2f20]">Test non eseguibile prima della conferma</span>
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-5">
            <article className="border border-black/15 bg-[#fbf8f0] p-6 shadow-[7px_7px_0_rgba(23,24,21,.08)] lg:p-8">
              <p className="font-mono text-[9px] uppercase tracking-[.22em] text-[#2457d6]">Domanda proposta</p>
              <h2 className="mt-3 max-w-4xl font-serif text-3xl font-semibold leading-[1.12]">{item.question}</h2>
              <div className="mt-5 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-wider text-black/50">
                <span className="border border-black/10 px-2 py-1">{item.difficulty}</span>
                <span className="border border-black/10 px-2 py-1">{item.questionType}</span>
                <span className="border border-black/10 px-2 py-1">{item.id}</span>
              </div>
            </article>

            {item.answerability === "answerable" ? <>
              <article className="border border-black/15 bg-white p-6 lg:p-8">
                <p className="font-mono text-[9px] uppercase tracking-[.22em] text-[#1e5949]">Etichetta attesa</p>
                <p className="mt-3 text-[15px] leading-7">{item.expected.answer}</p>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-black/70">{item.expected.keyFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
              </article>
              {item.evidencePacket.map((evidence) => <article key={evidence.chunkId} className="overflow-hidden border border-black/15 bg-white">
                <header className="border-b border-black/10 bg-[#e7e0d1] p-4">
                  <h3 className="font-serif text-lg font-semibold">{evidence.title}</h3>
                  <p className="mt-1 text-xs text-black/60">{evidence.section}{evidence.pageStart ? ` · pp. ${evidence.pageStart}${evidence.pageEnd !== evidence.pageStart ? `–${evidence.pageEnd}` : ""}` : ""}</p>
                  <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate font-mono text-[9px] text-[#2457d6] hover:underline">{evidence.sourceUrl}</a>
                </header>
                <div className="p-5 text-[14px] leading-7 text-black/75"><ReactMarkdown components={markdownComponents}>{evidence.excerpt}</ReactMarkdown></div>
              </article>)}
            </> : <article className="border border-black/15 bg-white p-6 lg:p-8">
              <div className="flex items-center gap-2"><ShieldAlert className="size-5 text-[#b93927]" /><p className="font-serif text-xl font-semibold">Verifica caso non rispondibile</p></div>
              <p className="mt-4 text-sm leading-6">{item.expected.refusalReason}</p>
              <p className="mt-5 font-mono text-[9px] uppercase tracking-[.2em] text-black/45">Scansione integrale · {item.corpusCheck?.checkedChunkCount.toLocaleString("it-IT")} chunk</p>
              <div className="mt-3 divide-y divide-black/10 border border-black/10">
                {item.corpusCheck?.probes.map((probe) => <div key={probe.text} className="flex items-center justify-between gap-4 p-3 text-sm"><code>{probe.text}</code><span className="font-mono text-xs text-[#1e5949]">{probe.matches} occorrenze</span></div>)}
              </div>
              <p className="mt-4 text-xs leading-5 text-black/55">Lo zero non prova l’assenza semantica in assoluto: serve proprio la tua conferma che tecnologia e dettaglio richiesto siano fuori dal corpus.</p>
            </article>}
          </div>

          <aside className="h-fit border border-black/15 bg-[#fbf8f0] p-6 xl:sticky xl:top-24">
            <div className="flex items-center gap-2"><FileCheck2 className="size-5 text-[#1e5949]" /><h2 className="font-serif text-xl font-semibold">Il tuo verdetto</h2></div>
            <p className="mt-2 text-xs leading-5 text-black/55">Approva solo se domanda, fatti attesi e classificazione sono corretti rispetto all’evidenza mostrata.</p>
            {currentPreAudit ? <div className={`mt-5 border-l-2 p-3 text-xs leading-5 ${currentPreAudit.authorSpotCheck ? "border-[#c67a1c] bg-[#c67a1c]/7" : "border-[#1e5949] bg-[#1e5949]/7"}`}>
              <p className="font-mono text-[9px] uppercase tracking-[.17em] text-black/50">Pre-audit · {currentPreAudit.confidence === "high" ? "alta confidenza" : "controllo consigliato"}</p>
              <p className="mt-2 text-black/70">{currentPreAudit.rationale}</p>
            </div> : null}
            <div className="mt-6 grid gap-3">
              <Decision active={review.decision === "approved"} onClick={() => decide("approved")} title="Approva il caso" description="Etichetta e prova sono adeguate." color="#1e5949" />
              <Decision active={review.decision === "needs-correction"} onClick={() => decide("needs-correction")} title="Da correggere" description="C’è un errore, un’ambiguità o manca evidenza." color="#b93927" />
            </div>
            <textarea value={review.notes ?? ""} onChange={(event) => setNotes(event.target.value)} placeholder="Se richiede correzione, indica brevemente cosa cambiare…" className="mt-5 min-h-28 w-full resize-y border border-black/15 bg-white p-3 text-sm leading-6 outline-none focus:border-[#2457d6]" />
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" disabled={currentIndex === 0} onClick={() => move(-1)} className="flex items-center justify-center gap-2 border border-black/15 px-3 py-2.5 text-sm disabled:opacity-25"><ArrowLeft className="size-4" />Indietro</button>
              <button type="button" disabled={currentIndex === benchmark.cases.length - 1} onClick={() => move(1)} className="flex items-center justify-center gap-2 bg-[#171815] px-3 py-2.5 text-sm text-white disabled:opacity-25">Avanti<ArrowRight className="size-4" /></button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  </main>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="border-r border-black/10 p-3 last:border-r-0"><strong className="block font-serif text-xl">{value}</strong><span className="font-mono text-[8px] uppercase tracking-wider text-black/45">{label}</span></div>;
}

function Decision({ active, onClick, title, description, color }: { active: boolean; onClick: () => void; title: string; description: string; color: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className="border p-4 text-left transition" style={{ borderColor: active ? color : "rgba(0,0,0,.12)", background: active ? color : "white", color: active ? "white" : "inherit" }}><span className="block font-serif text-lg font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 opacity-65">{description}</span></button>;
}

function SideButton({ onClick, icon: Icon, children, muted = false }: { onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; muted?: boolean }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 border px-3 py-2.5 text-left text-xs ${muted ? "border-transparent text-black/40" : "border-black/10 bg-white/45"}`}><Icon className="size-3.5" />{children}</button>;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="border border-black/10 bg-black/5 px-1 py-.5 font-mono text-[.88em]">{children}</code>,
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="mb-3 overflow-auto bg-[#171815] p-4 font-mono text-xs leading-6 text-white">{children}</pre>,
};
