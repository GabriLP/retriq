"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleAlert, Download, Eye, FileCheck2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { buildReviewTasks, exportReviewedCsv, isReviewComplete, type GenerationReviewTask, type ReviewCsvRow, type ReviewValues, type ScoreColumn } from "@/lib/evaluation/generation-review";

const storageKey = "retriq:generation-human-review:v1";
const flagColumns: ScoreColumn[] = ["critical_unsupported_claim_0_1", "contradicts_evidence_0_1", "invalid_citation_label_0_1", "generator_failure_0_1"];
const scoreDefinitions: Array<{ column: ScoreColumn; label: string; hint: string; max: number }> = [
  { column: "groundedness_0_4", label: "Supporto", hint: "Quanto è sostenuta dalle fonti?", max: 4 },
  { column: "key_fact_coverage_0_4", label: "Copertura", hint: "Quanti fatti attesi include?", max: 4 },
  { column: "citation_correctness_0_4", label: "Citazioni", hint: "Le fonti sostengono le frasi?", max: 4 },
  { column: "citation_completeness_0_4", label: "Completezza", hint: "Ogni fatto importante è citato?", max: 4 },
  { column: "directness_0_2", label: "Chiarezza", hint: "È diretta e ben delimitata?", max: 2 },
];

type StoredReview = { reviewerId: string; reviews: Record<string, ReviewValues>; currentTaskId?: string; savedAt?: string };

export function GenerationReviewWorkbench({ headers, rows, tasks: suppliedTasks }: { headers: string[]; rows: ReviewCsvRow[]; tasks: GenerationReviewTask[] }) {
  const tasks = useMemo(() => suppliedTasks.length ? suppliedTasks : buildReviewTasks(rows), [rows, suppliedTasks]);
  const [reviews, setReviews] = useState<Record<string, ReviewValues>>({});
  const [reviewerId, setReviewerId] = useState("Gabriele");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const task = tasks[currentIndex];
  const review = reviews[task?.id] ?? defaultReview();
  const completed = tasks.filter((item) => isReviewComplete(item, reviews[item.id])).length;
  const progress = Math.round(completed / Math.max(tasks.length, 1) * 100);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as StoredReview | null;
      if (stored) {
        setReviews(stored.reviews ?? {});
        setReviewerId(stored.reviewerId || "Gabriele");
        const index = tasks.findIndex((item) => item.id === stored.currentTaskId);
        if (index >= 0) setCurrentIndex(index);
      }
    } finally { setHydrated(true); }
  }, [tasks]);

  useEffect(() => {
    if (!hydrated || !task) return;
    const timestamp = new Date().toISOString();
    localStorage.setItem(storageKey, JSON.stringify({ reviewerId, reviews, currentTaskId: task.id, savedAt: timestamp } satisfies StoredReview));
  }, [hydrated, reviewerId, reviews, task]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [currentIndex]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === "e") setEvidenceOpen((value) => !value);
      if (event.key === "ArrowRight" && currentIndex < tasks.length - 1) { setEvidenceOpen(false); setCurrentIndex((value) => value + 1); }
      if (event.key === "ArrowLeft" && currentIndex > 0) { setEvidenceOpen(false); setCurrentIndex((value) => value - 1); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentIndex, tasks.length]);

  if (!task) return <main className="p-10">No review tasks available.</main>;

  function updateReview(patch: ReviewValues) {
    setReviews((current) => ({ ...current, [task.id]: { ...defaultReview(), ...current[task.id], ...patch } }));
  }

  function jumpToNextIncomplete() {
    const next = tasks.findIndex((item, index) => index > currentIndex && !isReviewComplete(item, reviews[item.id]));
    const wrapped = tasks.findIndex((item) => !isReviewComplete(item, reviews[item.id]));
    const target = next >= 0 ? next : wrapped;
    if (target >= 0) { setEvidenceOpen(false); setCurrentIndex(target); }
  }

  function downloadCsv() {
    const csv = exportReviewedCsv({ headers, rows, tasks, reviews, reviewerId, reviewedAt: new Date().toISOString() });
    downloadFile("generation-human-review-v1.completed.csv", csv, "text/csv;charset=utf-8");
  }

  function downloadBackup() {
    downloadFile("generation-human-review-v1.progress.json", JSON.stringify({ schemaVersion: 1, reviewerId, exportedAt: new Date().toISOString(), completed, total: tasks.length, reviews }, null, 2) + "\n", "application/json");
  }

  function resetProgress() {
    if (!window.confirm("Cancellare tutti i punteggi salvati in questo browser?")) return;
    localStorage.removeItem(storageKey); setReviews({}); setEvidenceOpen(false); setCurrentIndex(0);
  }

  return (
    <main className="min-h-screen bg-[#f1eee5] text-[#171714]">
      <header className="sticky top-0 z-30 border-b border-black/15 bg-[#f1eee5]/95 backdrop-blur">
        <div className="mx-auto grid max-w-[1500px] gap-4 px-4 py-3 lg:grid-cols-[260px_1fr_auto] lg:items-center lg:px-7">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center bg-[#d9472b] text-white"><FileCheck2 className="size-4" /></span>
            <div><p className="font-mono text-[10px] uppercase tracking-[0.22em] text-black/50">Retriq evaluation</p><p className="font-serif text-lg font-semibold">Blind review desk</p></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden bg-black/10"><div className="h-full bg-[#d9472b] transition-all duration-500" style={{ width: `${progress}%` }} /></div>
            <span className="min-w-24 font-mono text-xs">{completed}/{tasks.length} · {progress}%</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-black/55"><Save className="size-3.5" /><span>{hydrated ? "Autosave attivo" : "Caricamento…"}</span></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-r border-black/15 px-4 py-6 lg:min-h-[calc(100vh-66px)] lg:px-5">
          <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-black/45">Revisore</label>
          <input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} className="mt-2 w-full border-b border-black/25 bg-transparent py-2 font-serif text-lg outline-none focus:border-[#d9472b]" />
          <div className="mt-7 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/45">Casi</span><span className="text-xs text-black/45">48 effettivi</span></div>
          <div className="mt-3 grid grid-cols-8 gap-1.5 lg:grid-cols-6">
            {tasks.map((item, index) => {
              const done = isReviewComplete(item, reviews[item.id]);
              return <button key={item.id} title={`${index + 1}. ${item.caseId}`} onClick={() => { setEvidenceOpen(false); setCurrentIndex(index); }} className={`aspect-square border text-[10px] transition ${index === currentIndex ? "border-[#d9472b] bg-[#d9472b] text-white" : done ? "border-[#173f35] bg-[#173f35] text-white" : "border-black/15 bg-white/40 hover:border-black/50"}`}>{index + 1}</button>;
            })}
          </div>
          <div className="mt-8 space-y-2 border-t border-black/15 pt-5">
            <ActionButton onClick={downloadBackup} icon={Save}>Backup JSON</ActionButton>
            <ActionButton onClick={downloadCsv} icon={Download}>Esporta CSV</ActionButton>
            <ActionButton onClick={resetProgress} icon={RotateCcw} muted>Azzera tutto</ActionButton>
          </div>
          <p className="mt-6 text-xs leading-5 text-black/45">← → cambia risposta · E apre le fonti. I nomi dei modelli rimangono nascosti fino all’analisi finale.</p>
        </aside>

        <section className="px-4 py-6 lg:px-8 lg:py-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-black/15 pb-4">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-black/50"><span>{String(currentIndex + 1).padStart(2, "0")}/{tasks.length}</span><span>·</span><span>{task.language}</span><span>·</span><span>{task.answerability}</span>{task.answerability === "answerable" ? <><span>·</span><span>{task.blindVariantId}</span></> : null}</div>
            <div className={`flex items-center gap-2 text-xs font-medium ${isReviewComplete(task, reviews[task.id]) ? "text-[#173f35]" : "text-black/45"}`}>{isReviewComplete(task, reviews[task.id]) ? <Check className="size-4" /> : <CircleAlert className="size-4" />}{isReviewComplete(task, reviews[task.id]) ? "Valutazione completa" : "Da completare"}</div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
            <div className="space-y-5">
              <article className="border border-black/15 bg-[#faf8f1] p-5 shadow-[5px_5px_0_rgba(0,0,0,0.08)] lg:p-7">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#d9472b]">Domanda</p>
                <h1 className="mt-3 max-w-4xl font-serif text-2xl font-semibold leading-tight lg:text-3xl">{task.question}</h1>
                {task.expectedKeyFacts.length ? <div className="mt-6 border-l-2 border-[#d7a328] pl-4"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/45">Fatti attesi</p><ul className="mt-2 space-y-1.5 text-sm leading-6 text-black/70">{task.expectedKeyFacts.map((fact) => <li key={fact}>— {fact}</li>)}</ul></div> : null}
              </article>

              <article className="border border-black/15 bg-white p-5 lg:p-7">
                <div className="mb-4 flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/45">Risposta candidata</p><span className="rounded-full border border-black/15 px-2.5 py-1 font-mono text-[10px]">MODELLO NASCOSTO</span></div>
                <div className="text-[15px] leading-7"><ReactMarkdown components={reviewMarkdownComponents}>{task.candidateAnswer}</ReactMarkdown></div>
              </article>

              <section className="border border-black/15 bg-[#e8e3d5]">
                <button onClick={() => setEvidenceOpen((value) => !value)} className="flex w-full items-center justify-between p-4 text-left"><span className="flex items-center gap-2 font-medium"><Eye className="size-4" />Fonti congelate</span><span className="font-mono text-xs text-black/45">E · {evidenceOpen ? "nascondi" : "apri solo se serve"}</span></button>
                {evidenceOpen ? <EvidencePanel evidence={task.frozenEvidence} /> : null}
              </section>
            </div>

            <aside className="h-fit border border-black/15 bg-[#faf8f1] p-5 xl:sticky xl:top-24">
              <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-[#173f35]" /><h2 className="font-serif text-xl font-semibold">Scheda di giudizio</h2></div>
              <p className="mt-1 text-xs leading-5 text-black/50">Valuta solo rispetto alle fonti mostrate, senza conoscenza esterna.</p>
              {task.answerability === "answerable" ? <div className="mt-5 space-y-4">{scoreDefinitions.map((definition) => <ScoreControl key={definition.column} {...definition} value={review[definition.column]} onChange={(value) => updateReview({ [definition.column]: value })} />)}</div> : <div className="mt-5"><BinaryChoice label="Astensione corretta" hint="Rifiuta senza aggiungere dettagli tecnici non supportati?" value={review.correct_abstention_0_1} onChange={(value) => updateReview({ correct_abstention_0_1: value })} positive /></div>}
              <div className="mt-6 border-t border-black/15 pt-5"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/45">Errori critici</p><div className="mt-3 space-y-2">{flagColumns.map((column) => <FlagChoice key={column} label={flagLabel(column)} value={review[column] ?? 0} onChange={(value) => updateReview({ [column]: value })} />)}</div></div>
              <label className="mt-6 block"><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/45">Note facoltative</span><textarea value={review.reviewer_notes ?? ""} onChange={(event) => updateReview({ reviewer_notes: event.target.value })} placeholder="Annota soltanto omissioni o problemi utili…" className="mt-2 min-h-24 w-full resize-y border border-black/15 bg-white p-3 text-sm leading-6 outline-none focus:border-[#d9472b]" /></label>
              <div className="mt-5 grid grid-cols-2 gap-2"><button disabled={currentIndex === 0} onClick={() => { setEvidenceOpen(false); setCurrentIndex((value) => value - 1); }} className="flex items-center justify-center gap-2 border border-black/20 px-3 py-2.5 text-sm disabled:opacity-30"><ChevronLeft className="size-4" />Indietro</button><button onClick={() => { if (currentIndex < tasks.length - 1) { setEvidenceOpen(false); setCurrentIndex((value) => value + 1); } else jumpToNextIncomplete(); }} className="flex items-center justify-center gap-2 bg-[#171714] px-3 py-2.5 text-sm text-white">Avanti<ChevronRight className="size-4" /></button></div>
              {isReviewComplete(task, reviews[task.id]) && completed < tasks.length ? <button onClick={jumpToNextIncomplete} className="mt-2 w-full py-2 text-xs text-black/55 underline underline-offset-4">Vai al prossimo caso incompleto</button> : null}
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function defaultReview(): ReviewValues { return { critical_unsupported_claim_0_1: 0, contradicts_evidence_0_1: 0, invalid_citation_label_0_1: 0, generator_failure_0_1: 0 }; }
const reviewMarkdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="pl-1">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="border border-black/10 bg-black/5 px-1 py-0.5 font-mono text-[0.88em]">{children}</code>,
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="mb-3 overflow-auto bg-[#171714] p-4 font-mono text-xs leading-6 text-white [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
};

function EvidencePanel({ evidence }: { evidence: string }) {
  const excerpts = evidence.split("\n\n---\n\n").map(parseEvidenceExcerpt);
  return <div className="max-h-[640px] space-y-4 overflow-auto border-t border-black/15 bg-[#faf8f1] p-4 lg:p-5">{excerpts.map((excerpt, index) => <article key={`${excerpt.label}-${index}`} className="border border-black/15 bg-white"><header className="grid gap-2 border-b border-black/10 bg-[#f1eee5] p-3 sm:grid-cols-[auto_1fr]"><span className="grid size-8 place-items-center bg-[#171714] font-mono text-xs font-semibold text-white">{excerpt.label}</span><div><h3 className="font-serif text-base font-semibold">{excerpt.title}</h3><p className="mt-0.5 text-xs text-black/55">{excerpt.section}</p><p className="mt-1 truncate font-mono text-[10px] text-black/35">{excerpt.url}</p></div></header><div className="p-4 text-sm leading-6 text-black/75"><ReactMarkdown components={reviewMarkdownComponents}>{excerpt.content}</ReactMarkdown></div></article>)}</div>;
}

function parseEvidenceExcerpt(value: string) {
  const match = value.match(/^\[(S\d+)\]\nTitle: ([\s\S]*?)\nSection: ([\s\S]*?)\nURL: ([\s\S]*?)\nContent:\n([\s\S]*)$/);
  if (!match) return { label: "S?", title: "Frozen excerpt", section: "Unparsed evidence", url: "", content: value };
  return { label: match[1], title: match[2], section: match[3], url: match[4], content: match[5] };
}
function ScoreControl({ column, label, hint, max, value, onChange }: { column: ScoreColumn; label: string; hint: string; max: number; value?: number; onChange: (value: number) => void }) { return <fieldset><div className="flex items-end justify-between gap-3"><div><legend className="text-sm font-semibold">{label}</legend><p className="text-[11px] text-black/45">{hint}</p></div><span className="font-mono text-xs text-black/35">0—{max}</span></div><div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${max + 1}, minmax(0, 1fr))` }}>{Array.from({ length: max + 1 }, (_, score) => <button type="button" key={`${column}-${score}`} onClick={() => onChange(score)} aria-pressed={value === score} className={`h-9 border font-mono text-sm transition ${value === score ? "border-[#d9472b] bg-[#d9472b] text-white" : "border-black/15 bg-white hover:border-black/50"}`}>{score}</button>)}</div></fieldset>; }
function BinaryChoice({ label, hint, value, onChange, positive = false }: { label: string; hint: string; value?: number; onChange: (value: number) => void; positive?: boolean }) { return <div><p className="text-sm font-semibold">{label}</p><p className="mt-0.5 text-[11px] text-black/45">{hint}</p><div className="mt-2 grid grid-cols-2 gap-2"><button onClick={() => onChange(1)} className={`border px-3 py-2 text-sm ${value === 1 ? positive ? "border-[#173f35] bg-[#173f35] text-white" : "border-[#d9472b] bg-[#d9472b] text-white" : "border-black/15 bg-white"}`}>Sì · 1</button><button onClick={() => onChange(0)} className={`border px-3 py-2 text-sm ${value === 0 ? "border-black bg-black text-white" : "border-black/15 bg-white"}`}>No · 0</button></div></div>; }
function FlagChoice({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <button type="button" onClick={() => onChange(value === 1 ? 0 : 1)} className={`flex w-full items-center justify-between border px-3 py-2 text-left text-xs ${value === 1 ? "border-[#d9472b] bg-[#d9472b]/10 text-[#9f2f1d]" : "border-black/10 bg-white text-black/60"}`}><span>{label}</span><span className="font-mono">{value}</span></button>; }
function ActionButton({ onClick, icon: Icon, children, muted = false }: { onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; muted?: boolean }) { return <button onClick={onClick} className={`flex w-full items-center gap-2 border px-3 py-2 text-left text-xs ${muted ? "border-transparent text-black/40 hover:text-black" : "border-black/15 bg-white/50 hover:border-black/40"}`}><Icon className="size-3.5" />{children}</button>; }
function flagLabel(column: ScoreColumn) { return ({ critical_unsupported_claim_0_1: "Affermazione critica non supportata", contradicts_evidence_0_1: "Contraddice le fonti", invalid_citation_label_0_1: "Etichetta di citazione non valida", generator_failure_0_1: "Fallimento del generatore" } as Partial<Record<ScoreColumn, string>>)[column] ?? column; }
function downloadFile(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
