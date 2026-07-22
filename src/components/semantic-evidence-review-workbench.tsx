"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Download, FileCheck2, RotateCcw, Save, ShieldQuestion } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { exportSemanticEvidenceReviewCsv, type SemanticEvidenceReviewEntry, type SemanticEvidenceReviewTask } from "@/lib/evaluation/semantic-evidence-review";

type StudySettings = {
  eyebrow: string;
  heading: string;
  storageKey: string;
  sourceExperiment: string;
  exportFileName: string;
  backupFileName: string;
};

const defaultStudy: StudySettings = {
  eyebrow: "Retriq · evidence study",
  heading: "Alternative evidence audit",
  storageKey: "retriq:semantic-evidence-review:v1",
  sourceExperiment: "agentic-semantic-assessor-v1",
  exportFileName: "semantic-evidence-human-review-v1.completed.csv",
  backupFileName: "semantic-evidence-human-review-v1.progress.json",
};

export function SemanticEvidenceReviewWorkbench({ tasks, study }: { tasks: SemanticEvidenceReviewTask[]; study?: Partial<StudySettings> }) {
  const settings = { ...defaultStudy, ...study };
  const [reviewer, setReviewer] = useState("Gabriele");
  const [reviews, setReviews] = useState<Record<string, SemanticEvidenceReviewEntry>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const task = tasks[currentIndex];
  const review = reviews[task?.id] ?? {};
  const completed = tasks.filter((item) => reviews[item.id]?.sufficient !== undefined).length;
  const ready = completed === tasks.length && reviewer.trim().length > 0;

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(settings.storageKey) ?? "null") as { reviewer?: string; reviews?: Record<string, SemanticEvidenceReviewEntry>; currentTaskId?: string } | null;
      if (value) {
        setReviewer(value.reviewer || "Gabriele"); setReviews(value.reviews ?? {});
        const index = tasks.findIndex((item) => item.id === value.currentTaskId); if (index >= 0) setCurrentIndex(index);
      }
    } finally { setHydrated(true); }
  }, [settings.storageKey, tasks]);

  useEffect(() => { if (hydrated && task) localStorage.setItem(settings.storageKey, JSON.stringify({ reviewer, reviews, currentTaskId: task.id, savedAt: new Date().toISOString() })); }, [hydrated, reviewer, reviews, settings.storageKey, task]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [currentIndex]);
  if (!task) return <main className="p-10">Nessun caso da revisionare.</main>;
  if (!hydrated) return <ReviewLoadingState />;

  function decide(sufficient: boolean) { setReviews((current) => ({ ...current, [task.id]: { ...current[task.id], sufficient, reviewedAt: new Date().toISOString() } })); }
  function note(notes: string) { setReviews((current) => ({ ...current, [task.id]: { ...current[task.id], notes } })); }
  function move(delta: number) { setCurrentIndex((value) => Math.max(0, Math.min(tasks.length - 1, value + delta))); }
  function downloadCsv() { if (!ready) return; download(settings.exportFileName, exportSemanticEvidenceReviewCsv({ tasks, reviews, reviewer: reviewer.trim(), exportedAt: new Date().toISOString(), sourceExperiment: settings.sourceExperiment }), "text/csv;charset=utf-8"); }
  function backup() { download(settings.backupFileName, `${JSON.stringify({ schemaVersion: 1, sourceExperiment: settings.sourceExperiment, reviewer, reviews, exportedAt: new Date().toISOString() }, null, 2)}\n`, "application/json"); }
  function reset() { if (!window.confirm(`Eliminare i ${tasks.length} giudizi salvati in questo browser?`)) return; localStorage.removeItem(settings.storageKey); setReviews({}); setCurrentIndex(0); }

  return <main className="min-h-screen bg-[#f1ecdf] text-[#171815]">
    <header className="sticky top-0 z-30 border-b border-black/15 bg-[#f1ecdf]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1540px] flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-full bg-[#dd4f36] text-white"><ShieldQuestion className="size-5" /></span><div><p className="font-mono text-[9px] uppercase tracking-[.24em] text-[#b93927]">{settings.eyebrow}</p><h1 className="font-serif text-xl font-semibold">{settings.heading}</h1></div></div>
        <div className="flex min-w-[280px] flex-1 items-center gap-3 lg:max-w-xl"><span className="font-mono text-[10px] uppercase tracking-widest text-black/45">Cieco</span><div className="h-1.5 flex-1 bg-black/10"><div className="h-full bg-[#dd4f36] transition-all" style={{ width: `${completed / tasks.length * 100}%` }} /></div><span className="font-mono text-xs">{completed}/{tasks.length}</span></div>
        <span className="flex items-center gap-2 text-xs text-black/45"><Save className="size-3.5" />{hydrated ? "Salvato localmente" : "Caricamento…"}</span>
      </div>
    </header>

    <div className="mx-auto grid max-w-[1540px] lg:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="border-r border-black/15 p-5 lg:min-h-[calc(100vh-76px)] lg:p-7">
        <label className="font-mono text-[9px] uppercase tracking-[.2em] text-black/40">Revisore</label><input value={reviewer} onChange={(event) => setReviewer(event.target.value)} className="w-full border-b border-black/20 bg-transparent py-2 font-serif text-xl outline-none focus:border-[#dd4f36]" />
        <p className="mt-8 font-mono text-[9px] uppercase tracking-[.2em] text-black/40">{tasks.length} dossier</p>
        <div className="mt-3 space-y-2">{tasks.map((item, index) => { const done = reviews[item.id]?.sufficient !== undefined; return <button type="button" key={item.id} onClick={() => setCurrentIndex(index)} className={`flex w-full items-center gap-3 border p-3 text-left transition ${index === currentIndex ? "border-[#dd4f36] bg-[#dd4f36] text-white" : done ? "border-[#1e5949] bg-[#1e5949] text-white" : "border-black/10 bg-white/40 hover:border-black/35"}`}><span className="font-mono text-xs">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 truncate text-xs">{item.displayLabel ?? item.caseId}</span>{done ? <Check className="ml-auto size-3.5" /> : null}</button>; })}</div>
        <div className="mt-7 border-l-2 border-[#dd4f36] bg-white/45 p-4 text-xs leading-5 text-black/60"><CircleHelp className="mb-2 size-4 text-[#dd4f36]" /><strong className="text-black/80">Un solo criterio.</strong><br />Gli estratti bastano, da soli, per formulare una risposta completa e corretta?</div>
        <div className="mt-5 space-y-2"><button type="button" disabled={!ready} onClick={downloadCsv} className="flex w-full items-center justify-center gap-2 bg-[#171815] px-3 py-3 text-sm text-white disabled:opacity-25"><Download className="size-4" />Esporta CSV finale</button><SideAction icon={Save} onClick={backup}>Backup progresso</SideAction><SideAction icon={RotateCcw} onClick={reset} muted>Azzera revisione</SideAction></div>
      </aside>

      <section className="min-w-0 p-5 lg:p-8">
        <div className="mb-5 flex items-center justify-between border-b border-black/15 pb-4"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-black/45">Dossier {String(currentIndex + 1).padStart(2, "0")} · tentativo {task.attempt}</p><span className="font-mono text-[10px] text-black/40">Decisioni precedenti nascoste</span></div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="min-w-0 space-y-5">
            <article className="border border-black/15 bg-[#fbf8f0] p-6 shadow-[7px_7px_0_rgba(23,24,21,.08)] lg:p-8"><p className="font-mono text-[9px] uppercase tracking-[.22em] text-[#b93927]">Domanda originale</p><h2 className="mt-3 max-w-4xl font-serif text-3xl font-semibold leading-[1.12]">{task.question}</h2></article>
            <section className="space-y-4">{task.excerpts.map((excerpt) => <article key={`${task.id}-${excerpt.label}`} className="overflow-hidden border border-black/15 bg-white"><header className="grid gap-3 border-b border-black/10 bg-[#e7e0d1] p-4 sm:grid-cols-[42px_1fr_auto]"><span className="grid size-10 place-items-center rounded-full bg-[#171815] font-mono text-xs font-bold text-white">{excerpt.label}</span><div className="min-w-0"><h3 className="font-serif text-lg font-semibold">{excerpt.title}</h3><p className="text-xs text-black/55">{excerpt.section}</p><a href={excerpt.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate font-mono text-[9px] text-[#b93927] hover:underline">{excerpt.sourceUrl}</a></div><div className="text-right font-mono text-[9px] uppercase text-black/40"><span>{excerpt.language ?? "—"}</span><br /><span>{Math.round(excerpt.score * 100)}% match</span></div></header><div className="p-5 text-[14px] leading-7 text-black/75 lg:p-6"><ReactMarkdown components={markdownComponents}>{excerpt.content}</ReactMarkdown></div></article>)}</section>
          </div>

          <aside className="h-fit border border-black/15 bg-[#fbf8f0] p-6 xl:sticky xl:top-24"><div className="flex items-center gap-2"><FileCheck2 className="size-5 text-[#1e5949]" /><h2 className="font-serif text-xl font-semibold">Il tuo verdetto</h2></div><p className="mt-2 text-xs leading-5 text-black/55">Valuta il contenuto, non la corrispondenza con una specifica fonte canonica. Per un confronto devono essere coperti entrambi i lati.</p>
            <div className="mt-6 grid gap-3"><Decision active={review.sufficient === true} onClick={() => decide(true)} title="Evidenza sufficiente" description="Posso rispondere completamente e senza inferenze esterne." positive /><Decision active={review.sufficient === false} onClick={() => decide(false)} title="Evidenza insufficiente" description="Manca almeno un fatto essenziale o un lato del confronto." /></div>
            <textarea value={review.notes ?? ""} onChange={(event) => note(event.target.value)} placeholder="Nota facoltativa: cosa manca o perché basta…" className="mt-5 min-h-28 w-full resize-y border border-black/15 bg-white p-3 text-sm leading-6 outline-none focus:border-[#dd4f36]" />
            <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" disabled={currentIndex === 0} onClick={() => move(-1)} className="flex items-center justify-center gap-2 border border-black/15 px-3 py-2.5 text-sm disabled:opacity-25"><ArrowLeft className="size-4" />Indietro</button><button type="button" disabled={currentIndex === tasks.length - 1} onClick={() => move(1)} className="flex items-center justify-center gap-2 bg-[#171815] px-3 py-2.5 text-sm text-white disabled:opacity-25">Avanti<ArrowRight className="size-4" /></button></div>
          </aside>
        </div>
      </section>
    </div>
  </main>;
}

function ReviewLoadingState() {
  return <main className="grid min-h-screen place-items-center bg-[#f1ecdf] px-6 text-[#171815]">
    <div className="w-full max-w-md border border-black/15 bg-[#fbf8f0] p-8 text-center shadow-[7px_7px_0_rgba(23,24,21,.08)]">
      <ShieldQuestion className="mx-auto size-7 text-[#dd4f36]" />
      <p className="mt-4 font-mono text-[9px] uppercase tracking-[.24em] text-[#b93927]">Retriq · evidence study</p>
      <p className="mt-2 font-serif text-2xl font-semibold">Ripristino della revisione…</p>
    </div>
  </main>;
}

function Decision({ active, onClick, title, description, positive = false }: { active: boolean; onClick: () => void; title: string; description: string; positive?: boolean }) { const color = positive ? "#1e5949" : "#b93927"; return <button type="button" aria-pressed={active} onClick={onClick} className="border p-4 text-left transition" style={{ borderColor: active ? color : "rgba(0,0,0,.12)", background: active ? color : "white", color: active ? "white" : "inherit" }}><span className="block font-serif text-lg font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 opacity-65">{description}</span></button>; }
function SideAction({ icon: Icon, onClick, children, muted = false }: { icon: React.ComponentType<{ className?: string }>; onClick: () => void; children: React.ReactNode; muted?: boolean }) { return <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 border px-3 py-2.5 text-left text-xs ${muted ? "border-transparent text-black/40" : "border-black/10 bg-white/45"}`}><Icon className="size-3.5" />{children}</button>; }
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
const markdownComponents = { p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>, ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>, ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>, code: ({ children }: { children?: React.ReactNode }) => <code className="border border-black/10 bg-black/5 px-1 py-.5 font-mono text-[.88em]">{children}</code>, pre: ({ children }: { children?: React.ReactNode }) => <pre className="mb-3 overflow-auto bg-[#171815] p-4 font-mono text-xs leading-6 text-white">{children}</pre> };
