"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Download, Eye, FileLock2, FlaskConical, RotateCcw, Save, Scale, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { compactLabel, defaultAdjudication, exportAdjudicationCsv, isAdjudicationComplete, isPhaseOneComplete, type AdjudicationDecision, type AdjudicationEntry, type FrozenPhaseOne, type JudgeAdjudicationTask } from "@/lib/evaluation/judge-adjudication";
import type { ReviewValues, ScoreColumn } from "@/lib/evaluation/generation-review";
import type { JudgeLabel } from "@/lib/evaluation/judge-metrics";

const storageKey = "retriq:judge-human-adjudication:v1";
const flagColumns: ScoreColumn[] = ["critical_unsupported_claim_0_1", "contradicts_evidence_0_1", "invalid_citation_label_0_1", "generator_failure_0_1"];
const scoreDefinitions: Array<{ column: ScoreColumn; key: keyof JudgeLabel; label: string; question: string; options: string[] }> = [
  { column: "groundedness_0_4", key: "groundedness", label: "Supporto", question: "Le affermazioni sono sostenute dalle fonti?", options: ["No", "Poco", "In parte", "Quasi tutte", "Tutte"] },
  { column: "key_fact_coverage_0_4", key: "keyFactCoverage", label: "Copertura", question: "Quanti fatti essenziali sono presenti?", options: ["Nessuno", "Meno di metà", "Almeno metà", "Quasi tutti", "Tutti"] },
  { column: "citation_correctness_0_4", key: "citationCorrectness", label: "Correttezza citazioni", question: "Le fonti citate sostengono le frasi associate?", options: ["Per nulla", "Raramente", "In parte", "Quasi sempre", "Sempre"] },
  { column: "citation_completeness_0_4", key: "citationCompleteness", label: "Completezza citazioni", question: "I fatti importanti hanno una citazione adeguata?", options: ["Nessuno", "Pochi", "Alcuni", "Quasi tutti", "Tutti"] },
  { column: "directness_0_2", key: "directness", label: "Chiarezza", question: "La risposta è diretta e ben delimitata?", options: ["No", "Abbastanza", "Sì"] }
];

type Phase = "blind" | "compare";
type StoredState = {
  reviewerId: string;
  phase: Phase;
  reviews: Record<string, AdjudicationEntry>;
  phaseOne?: FrozenPhaseOne;
  currentTaskId?: string;
  savedAt?: string;
};

export function JudgeAdjudicationWorkbench({ tasks }: { tasks: JudgeAdjudicationTask[] }) {
  const [reviewerId, setReviewerId] = useState("Gabriele");
  const [phase, setPhase] = useState<Phase>("blind");
  const [reviews, setReviews] = useState<Record<string, AdjudicationEntry>>({});
  const [phaseOne, setPhaseOne] = useState<FrozenPhaseOne>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const task = tasks[currentIndex];
  const review = reviews[task?.id] ?? defaultAdjudication();
  const blindCompleted = tasks.filter((item) => isPhaseOneComplete(item, reviews[item.id])).length;
  const adjudicated = tasks.filter((item) => isAdjudicationComplete(item, reviews[item.id])).length;
  const completed = phase === "blind" ? blindCompleted : adjudicated;
  const progress = Math.round(completed / Math.max(tasks.length, 1) * 100);
  const phaseOneReady = blindCompleted === tasks.length;
  const exportReady = phase === "compare" && adjudicated === tasks.length && phaseOne;

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as StoredState | null;
      if (stored) {
        setReviewerId(stored.reviewerId || "Gabriele");
        setPhase(stored.phase ?? "blind");
        setReviews(stored.reviews ?? {});
        setPhaseOne(stored.phaseOne);
        const index = tasks.findIndex((item) => item.id === stored.currentTaskId);
        if (index >= 0) setCurrentIndex(index);
      }
    } finally { setHydrated(true); }
  }, [tasks]);

  useEffect(() => {
    if (!hydrated || !task) return;
    localStorage.setItem(storageKey, JSON.stringify({ reviewerId, phase, reviews, phaseOne, currentTaskId: task.id, savedAt: new Date().toISOString() } satisfies StoredState));
  }, [hydrated, phase, phaseOne, reviewerId, reviews, task]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [currentIndex]);

  const excerpts = useMemo(() => parseEvidence(task?.frozenEvidence ?? ""), [task?.frozenEvidence]);
  if (!task) return <main className="p-10">Nessun caso disponibile.</main>;

  function updateReview(patch: AdjudicationEntry) {
    setReviews((current) => ({ ...current, [task.id]: { ...defaultAdjudication(), ...current[task.id], ...patch } }));
  }

  function navigate(delta: number) {
    setCurrentIndex((index) => Math.max(0, Math.min(tasks.length - 1, index + delta)));
    setEvidenceOpen(true);
  }

  function freezeBlindReview() {
    if (!phaseOneReady) return;
    if (!window.confirm("Congelare i 15 voti indipendenti e mostrare il confronto? I valori iniziali resteranno conservati.")) return;
    const frozenAt = new Date().toISOString();
    const snapshot = Object.fromEntries(tasks.map((item) => [item.id, stripDecision(reviews[item.id])]));
    setPhaseOne({ frozenAt, reviews: snapshot });
    setPhase("compare");
    setCurrentIndex(0);
  }

  function applyDecision(decision: AdjudicationDecision) {
    if (decision === "revise-human") updateReview({ ...entryFromLabel(task.originalHuman), decision });
    else if (decision === "revise-judge") updateReview({ ...entryFromLabel(task.judge), decision });
    else updateReview({ decision });
  }

  function downloadCsv() {
    if (!phaseOne) return;
    const csv = exportAdjudicationCsv({ tasks, phaseOne, reviews, reviewerId: reviewerId.trim(), exportedAt: new Date().toISOString() });
    downloadFile("llm-judge-human-adjudication-v1.completed.csv", csv, "text/csv;charset=utf-8");
  }

  function downloadBackup() {
    downloadFile("llm-judge-human-adjudication-v1.progress.json", `${JSON.stringify({ schemaVersion: 1, reviewerId, phase, phaseOne, reviews, exportedAt: new Date().toISOString() }, null, 2)}\n`, "application/json");
  }

  function resetAll() {
    if (!window.confirm("Eliminare la revisione salvata in questo browser?")) return;
    localStorage.removeItem(storageKey);
    setPhase("blind"); setPhaseOne(undefined); setReviews({}); setCurrentIndex(0); setEvidenceOpen(true);
  }

  return (
    <main className="min-h-screen bg-[#f3efe4] text-[#191a17]">
      <header className="sticky top-0 z-40 border-b border-[#191a17]/15 bg-[#f3efe4]/95 backdrop-blur-md">
        <div className="mx-auto grid max-w-[1580px] gap-3 px-4 py-3 lg:grid-cols-[280px_1fr_auto] lg:items-center lg:px-7">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-[#234fd2] text-white"><Scale className="size-4" /></span>
            <div><p className="font-mono text-[9px] uppercase tracking-[0.24em] text-[#234fd2]">Retriq · judge study</p><p className="font-serif text-lg font-semibold">Adjudication notebook</p></div>
          </div>
          <div className="flex items-center gap-3"><span className="font-mono text-[10px] uppercase tracking-[0.15em] text-black/45">Fase {phase === "blind" ? "1 · cieca" : "2 · confronto"}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-[#234fd2] transition-all duration-500" style={{ width: `${progress}%` }} /></div><span className="min-w-20 font-mono text-xs">{completed}/{tasks.length}</span></div>
          <div className="flex items-center gap-2 text-xs text-black/50"><Save className="size-3.5" />{hydrated ? "Salvato localmente" : "Caricamento…"}</div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1580px] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-r border-black/15 px-4 py-6 lg:min-h-[calc(100vh-65px)] lg:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/40">Revisore</p>
          <input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} className="mt-1 w-full border-b border-black/20 bg-transparent py-2 font-serif text-xl outline-none focus:border-[#234fd2]" />
          <div className="mt-7 flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/40">Quaderno</p><span className="text-xs text-black/45">15 casi unici</span></div>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {tasks.map((item, index) => {
              const done = phase === "blind" ? isPhaseOneComplete(item, reviews[item.id]) : isAdjudicationComplete(item, reviews[item.id]);
              return <button type="button" key={item.id} title={`${index + 1}. ${item.caseId}`} onClick={() => { setCurrentIndex(index); setEvidenceOpen(true); }} className={`relative aspect-square rounded-full border font-mono text-[11px] transition ${index === currentIndex ? "border-[#234fd2] bg-[#234fd2] text-white shadow-[0_0_0_4px_rgba(35,79,210,0.12)]" : done ? "border-[#17483b] bg-[#17483b] text-white" : "border-black/15 bg-white/45 hover:border-black/50"}`}>{index + 1}{item.answerability === "unanswerable" ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[#d9a424]" /> : null}</button>;
            })}
          </div>
          <div className="mt-7 rounded-sm border border-black/10 bg-white/45 p-4 text-xs leading-5 text-black/55">
            {phase === "blind" ? <><FileLock2 className="mb-2 size-4 text-[#234fd2]" /><strong className="text-black/75">Riferimenti nascosti.</strong><br />Valuta soltanto risposta, fatti attesi e fonti. Il confronto apparirà dopo aver congelato tutti i voti.</> : <><Eye className="mb-2 size-4 text-[#234fd2]" /><strong className="text-black/75">Confronto attivo.</strong><br />Ora puoi mantenere o correggere il voto. La prima valutazione resta immutabile.</>}
          </div>
          <div className="mt-5 space-y-2">
            {phase === "blind" ? <button type="button" disabled={!phaseOneReady} onClick={freezeBlindReview} className="flex w-full items-center justify-center gap-2 bg-[#191a17] px-3 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-25"><FileLock2 className="size-4" />Congela e confronta</button> : <button type="button" disabled={!exportReady} onClick={downloadCsv} className="flex w-full items-center justify-center gap-2 bg-[#234fd2] px-3 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-25"><Download className="size-4" />Esporta CSV finale</button>}
            <SidebarAction icon={Save} onClick={downloadBackup}>Backup progresso</SidebarAction>
            <SidebarAction icon={RotateCcw} onClick={resetAll} muted>Azzera revisione</SidebarAction>
          </div>
        </aside>

        <section className="min-w-0 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-black/15 pb-4">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-black/45"><span>{String(currentIndex + 1).padStart(2, "0")}/{tasks.length}</span><span>·</span><span>{task.language}</span><span>·</span><span>{task.answerability === "answerable" ? "risposta tecnica" : "controllo astensione"}</span></div>
            <span className={`flex items-center gap-2 text-xs ${isPhaseOneComplete(task, review) ? "text-[#17483b]" : "text-black/40"}`}>{isPhaseOneComplete(task, review) ? <Check className="size-4" /> : <FlaskConical className="size-4" />}{phase === "blind" ? isPhaseOneComplete(task, review) ? "Voto completo" : "Da valutare" : isAdjudicationComplete(task, review) ? "Caso adjudicato" : "Decisione richiesta"}</span>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-5">
              <article className="border border-black/15 bg-[#fbf9f3] p-5 shadow-[6px_6px_0_rgba(25,26,23,0.08)] lg:p-7">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#234fd2]">Domanda di ricerca</p>
                <h1 className="mt-3 max-w-4xl font-serif text-2xl font-semibold leading-[1.15] lg:text-[2rem]">{task.question}</h1>
                {task.expectedKeyFacts.length ? <div className="mt-6 border-l-2 border-[#d9a424] pl-4"><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/40">Fatti attesi</p><ul className="mt-2 space-y-1.5 text-sm leading-6 text-black/65">{task.expectedKeyFacts.map((fact) => <li key={fact}>— {fact}</li>)}</ul></div> : <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#d9a424]/15 px-3 py-1.5 text-xs text-[#6f5310]">Nessuna evidenza accettata: la risposta dovrebbe astenersi.</p>}
              </article>

              <article className="border border-black/15 bg-white p-5 lg:p-7">
                <div className="mb-4 flex items-center justify-between gap-3"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/40">Risposta candidata</p><span className="rounded-full border border-black/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-black/45">modello nascosto</span></div>
                <div className="text-[15px] leading-7 text-black/80"><ReactMarkdown components={markdownComponents}>{task.candidateAnswer}</ReactMarkdown></div>
              </article>

              <section className="overflow-hidden border border-black/15 bg-[#e7e2d5]">
                <button type="button" onClick={() => setEvidenceOpen((value) => !value)} className="flex w-full items-center justify-between p-4 text-left"><span className="flex items-center gap-2 font-medium"><BookOpen className="size-4 text-[#234fd2]" />Evidenza congelata <span className="font-mono text-[10px] text-black/40">{excerpts.length} excerpt</span></span><ChevronDown className={`size-4 transition-transform ${evidenceOpen ? "rotate-180" : ""}`} /></button>
                {evidenceOpen ? <div className="max-h-[720px] space-y-4 overflow-auto border-t border-black/10 bg-[#f8f5ed] p-4">{excerpts.length ? excerpts.map((excerpt, index) => <EvidenceCard key={`${excerpt.label}-${index}`} excerpt={excerpt} />) : <p className="p-6 text-center text-sm text-black/45">Nessuna evidenza ha superato la soglia di retrieval.</p>}</div> : null}
              </section>

              {phase === "compare" ? <ReferenceComparison task={task} phaseOne={phaseOne?.reviews[task.id]} finalReview={review} /> : null}
            </div>

            <aside className="h-fit border border-black/15 bg-[#fbf9f3] p-5 xl:sticky xl:top-24 lg:p-6">
              <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-[#17483b]" /><h2 className="font-serif text-xl font-semibold">Il tuo giudizio</h2></div>
              <p className="mt-1 text-xs leading-5 text-black/50">Usa esclusivamente l’evidenza mostrata, anche se conosci già l’argomento.</p>
              {task.answerability === "answerable" ? <div className="mt-6 space-y-5">{scoreDefinitions.map((definition) => <VerbalScore key={definition.column} definition={definition} value={review[definition.column]} onChange={(value) => updateReview({ [definition.column]: value })} />)}</div> : <div className="mt-6"><p className="text-sm font-semibold">L’astensione è corretta?</p><p className="mt-1 text-xs leading-5 text-black/45">Deve rifiutare la risposta senza introdurre dettagli tecnici.</p><div className="mt-3 grid grid-cols-2 gap-2"><Choice active={review.correct_abstention_0_1 === 1} onClick={() => updateReview({ correct_abstention_0_1: 1 })}>Sì · 1</Choice><Choice active={review.correct_abstention_0_1 === 0} onClick={() => updateReview({ correct_abstention_0_1: 0 })}>No · 0</Choice></div></div>}

              <details className="mt-6 border-t border-black/15 pt-5"><summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-black/45">Errori critici · apri solo se presenti</summary><div className="mt-3 space-y-2">{flagColumns.map((column) => <button type="button" key={column} onClick={() => updateReview({ [column]: review[column] === 1 ? 0 : 1 })} className={`flex w-full items-center justify-between border px-3 py-2 text-left text-xs ${review[column] === 1 ? "border-[#b73a28] bg-[#b73a28]/10 text-[#8c291b]" : "border-black/10 bg-white text-black/55"}`}><span>{flagLabel(column)}</span><span className="font-mono">{review[column] ?? 0}</span></button>)}</div></details>

              {phase === "compare" ? <div className="mt-6 border-t-2 border-[#234fd2] pt-5"><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#234fd2]">Decisione finale</p><div className="mt-3 grid gap-2"><DecisionButton active={review.decision === "confirm-independent"} onClick={() => applyDecision("confirm-independent")}>Confermo il mio nuovo voto</DecisionButton><DecisionButton active={review.decision === "revise-human"} onClick={() => applyDecision("revise-human")}>Ripristina la prima revisione</DecisionButton><DecisionButton active={review.decision === "revise-judge"} onClick={() => applyDecision("revise-judge")}>Adotta il voto del judge</DecisionButton><DecisionButton active={review.decision === "evidence-ambiguous"} onClick={() => applyDecision("evidence-ambiguous")}>Evidenza insufficiente o ambigua</DecisionButton></div><textarea value={review.adjudication_notes ?? ""} onChange={(event) => updateReview({ adjudication_notes: event.target.value })} placeholder="Nota facoltativa sul disaccordo…" className="mt-3 min-h-20 w-full resize-y border border-black/15 bg-white p-3 text-sm leading-5 outline-none focus:border-[#234fd2]" /></div> : <textarea value={review.reviewer_notes ?? ""} onChange={(event) => updateReview({ reviewer_notes: event.target.value })} placeholder="Nota facoltativa…" className="mt-6 min-h-20 w-full resize-y border border-black/15 bg-white p-3 text-sm leading-5 outline-none focus:border-[#234fd2]" />}

              <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" disabled={currentIndex === 0} onClick={() => navigate(-1)} className="flex items-center justify-center gap-2 border border-black/15 px-3 py-2.5 text-sm disabled:opacity-25"><ArrowLeft className="size-4" />Indietro</button><button type="button" disabled={currentIndex === tasks.length - 1} onClick={() => navigate(1)} className="flex items-center justify-center gap-2 bg-[#191a17] px-3 py-2.5 text-sm text-white disabled:opacity-25">Avanti<ArrowRight className="size-4" /></button></div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function VerbalScore({ definition, value, onChange }: { definition: typeof scoreDefinitions[number]; value?: number; onChange: (value: number) => void }) {
  return <fieldset><legend className="text-sm font-semibold">{definition.label}</legend><p className="mt-0.5 text-[11px] leading-4 text-black/45">{definition.question}</p><div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${definition.options.length}, minmax(0, 1fr))` }}>{definition.options.map((label, score) => <button type="button" key={label} title={`${score} · ${label}`} aria-pressed={value === score} onClick={() => onChange(score)} className={`min-h-12 border px-1 py-1.5 text-center transition ${value === score ? "border-[#234fd2] bg-[#234fd2] text-white" : "border-black/10 bg-white hover:border-black/40"}`}><span className="block font-mono text-xs font-semibold">{score}</span><span className="mt-0.5 block text-[9px] leading-3 opacity-75">{label}</span></button>)}</div></fieldset>;
}

function ReferenceComparison({ task, phaseOne, finalReview }: { task: JudgeAdjudicationTask; phaseOne?: ReviewValues; finalReview: AdjudicationEntry }) {
  const rows = task.answerability === "answerable" ? scoreDefinitions : [];
  return <section className="border-2 border-[#234fd2] bg-[#eef2ff] p-5 lg:p-7"><div className="flex items-center gap-2"><Scale className="size-5 text-[#234fd2]" /><h2 className="font-serif text-xl font-semibold">Confronto dei giudizi</h2></div><p className="mt-1 text-xs text-black/50">Il tuo voto cieco è congelato. Usa questo confronto per decidere il valore finale.</p>{task.answerability === "answerable" ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-left text-xs"><thead><tr className="border-b border-[#234fd2]/20 font-mono text-[9px] uppercase tracking-wider text-black/45"><th className="py-2">Dimensione</th><th>Nuovo cieco</th><th>Prima revisione</th><th>GPT-5.4 Nano</th><th>Finale</th></tr></thead><tbody>{rows.map((row) => <tr key={row.column} className="border-b border-[#234fd2]/10"><th className="py-2.5 font-medium">{row.label}</th><td className="font-mono">{phaseOne?.[row.column] ?? "—"}</td><td className="font-mono">{String(task.originalHuman[row.key] ?? "—")}</td><td className="font-mono">{String(task.judge[row.key] ?? "—")}</td><td className="font-mono font-bold text-[#234fd2]">{finalReview[row.column] ?? "—"}</td></tr>)}</tbody></table></div> : <div className="mt-5 grid grid-cols-3 gap-3 text-center"><ReferenceValue label="Nuovo cieco" value={phaseOne?.correct_abstention_0_1} /><ReferenceValue label="Prima revisione" value={task.originalHuman.correctAbstention} /><ReferenceValue label="Judge" value={task.judge.correctAbstention} /></div>}<div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="border border-[#234fd2]/15 bg-white/65 p-4"><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/40">Motivazione del judge</p><p className="mt-2 text-sm leading-6 text-black/70">{task.judgeRationale}</p></div><div className="border border-[#234fd2]/15 bg-white/65 p-4"><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/40">Controllo rapido</p><p className="mt-2 text-sm leading-6 text-black/70">Prima revisione: <span className="font-mono">{compactLabel(task.originalHuman)}</span><br />Judge: <span className="font-mono">{compactLabel(task.judge)}</span></p>{task.originalHumanNotes ? <p className="mt-2 text-xs text-black/50">Nota originale: {task.originalHumanNotes}</p> : null}</div></div></section>;
}

function EvidenceCard({ excerpt }: { excerpt: EvidenceExcerpt }) { return <article className="border border-black/10 bg-white"><header className="grid gap-2 border-b border-black/10 bg-[#efebe1] p-3 sm:grid-cols-[auto_1fr]"><span className="grid size-8 place-items-center rounded-full bg-[#191a17] font-mono text-xs font-semibold text-white">{excerpt.label}</span><div><h3 className="font-serif font-semibold">{excerpt.title}</h3><p className="text-xs text-black/50">{excerpt.section}</p><p className="mt-1 truncate font-mono text-[9px] text-black/35">{excerpt.url}</p></div></header><div className="p-4 text-sm leading-6 text-black/70"><ReactMarkdown components={markdownComponents}>{excerpt.content}</ReactMarkdown></div></article>; }
function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`border px-3 py-2.5 text-sm ${active ? "border-[#234fd2] bg-[#234fd2] text-white" : "border-black/10 bg-white"}`}>{children}</button>; }
function DecisionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`border px-3 py-2.5 text-left text-xs transition ${active ? "border-[#234fd2] bg-[#234fd2] text-white" : "border-black/10 bg-white hover:border-[#234fd2]/60"}`}>{children}</button>; }
function ReferenceValue({ label, value }: { label: string; value: number | null | undefined }) { return <div className="border border-[#234fd2]/15 bg-white/60 p-3"><p className="font-mono text-[9px] uppercase text-black/40">{label}</p><p className="mt-1 font-mono text-xl font-bold">{value ?? "—"}</p></div>; }
function SidebarAction({ icon: Icon, onClick, children, muted = false }: { icon: React.ComponentType<{ className?: string }>; onClick: () => void; children: React.ReactNode; muted?: boolean }) { return <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 border px-3 py-2.5 text-left text-xs ${muted ? "border-transparent text-black/40 hover:text-black" : "border-black/10 bg-white/50 hover:border-black/30"}`}><Icon className="size-3.5" />{children}</button>; }

type EvidenceExcerpt = { label: string; title: string; section: string; url: string; content: string };
function parseEvidence(evidence: string): EvidenceExcerpt[] { return evidence ? evidence.split("\n\n---\n\n").map((value) => { const match = value.match(/^\[(S\d+)\]\nTitle: ([\s\S]*?)\nSection: ([\s\S]*?)\nURL: ([\s\S]*?)\nContent:\n([\s\S]*)$/); return match ? { label: match[1], title: match[2], section: match[3], url: match[4], content: match[5] } : { label: "S?", title: "Frozen excerpt", section: "Unparsed evidence", url: "", content: value }; }) : []; }
function stripDecision(review?: AdjudicationEntry): ReviewValues {
  if (!review) return {};
  const values = { ...review };
  delete values.decision;
  delete values.adjudication_notes;
  return values;
}
function entryFromLabel(label: JudgeLabel): AdjudicationEntry { return { groundedness_0_4: label.groundedness ?? undefined, key_fact_coverage_0_4: label.keyFactCoverage ?? undefined, citation_correctness_0_4: label.citationCorrectness ?? undefined, citation_completeness_0_4: label.citationCompleteness ?? undefined, directness_0_2: label.directness ?? undefined, correct_abstention_0_1: label.correctAbstention ?? undefined, critical_unsupported_claim_0_1: label.criticalUnsupportedClaim, contradicts_evidence_0_1: label.contradictsEvidence, invalid_citation_label_0_1: label.invalidCitationLabel, generator_failure_0_1: label.generatorFailure }; }
function flagLabel(column: ScoreColumn) { return ({ critical_unsupported_claim_0_1: "Affermazione critica non supportata", contradicts_evidence_0_1: "Contraddice le fonti", invalid_citation_label_0_1: "Citazione inesistente", generator_failure_0_1: "Risposta troncata o inutilizzabile" } as Partial<Record<ScoreColumn, string>>)[column] ?? column; }
function downloadFile(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="pl-1">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-black">{children}</strong>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="border border-black/10 bg-black/5 px-1 py-0.5 font-mono text-[0.88em]">{children}</code>,
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="mb-3 overflow-auto bg-[#191a17] p-4 font-mono text-xs leading-6 text-white [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>
};
