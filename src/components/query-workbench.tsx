"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ExternalLink, FileSearch, Hash, Loader2, MessageSquareText, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { Citation, QueryResponse, RetrievalResult } from "@/lib/rag/types";

const starterQuestion = "How should I break a React UI into a component hierarchy?";

export function QueryWorkbench() {
  const [question, setQuestion] = useState(starterQuestion);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCitationLabel, setActiveCitationLabel] = useState<string | null>(null);
  const [citationTooltipPosition, setCitationTooltipPosition] = useState<{ left: number; top: number } | null>(null);
  const citationTooltipRef = useRef<HTMLDivElement>(null);

  const retrievalLevel = useMemo(() => {
    if (result && isInsufficientAnswer(result.answer)) {
      return { label: "Insufficient context", tone: "bg-zinc-100 text-zinc-700" };
    }

    const topScore = result?.retrievedChunks[0]?.score ?? 0;
    if (topScore >= 0.55) return { label: "High match", tone: "bg-emerald-100 text-emerald-800" };
    if (topScore >= 0.32) return { label: "Partial match", tone: "bg-amber-100 text-amber-800" };
    return { label: "Weak match", tone: "bg-zinc-100 text-zinc-700" };
  }, [result]);

  const citationsByLabel = useMemo(() => {
    return new Map(result?.citations.map((citation) => [citation.label, citation]) ?? []);
  }, [result]);

  const chunksByLabel = useMemo(() => {
    return new Map(result?.retrievedChunks.map((chunk) => [`S${chunk.rank}`, chunk]) ?? []);
  }, [result]);

  const answerMarkdown = useMemo(() => {
    if (!result) return "";
    return linkCitationReferences(result.answer, citationsByLabel);
  }, [citationsByLabel, result]);

  const citationClaimsByLabel = useMemo(() => {
    if (!result) return new Map<string, string>();
    return extractCitationClaims(result.answer, citationsByLabel);
  }, [citationsByLabel, result]);

  const activeCitation = activeCitationLabel ? citationsByLabel.get(activeCitationLabel) : undefined;
  const activeChunk = activeCitationLabel ? chunksByLabel.get(activeCitationLabel) : undefined;
  const activeClaim = activeCitationLabel ? citationClaimsByLabel.get(activeCitationLabel) : undefined;

  function openCitationTooltip(label: string, element: HTMLElement) {
    const rect = element.getBoundingClientRect();

    setActiveCitationLabel(label);
    setCitationTooltipPosition({
      left: Math.min(Math.max(rect.left + rect.width / 2, 176), window.innerWidth - 176),
      top: rect.bottom - 1,
    });
  }

  function closeCitationTooltip(event: React.FocusEvent | React.PointerEvent | React.MouseEvent) {
    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof HTMLElement) {
      if (citationTooltipRef.current?.contains(relatedTarget)) return;
      if (relatedTarget.closest("[data-citation-label]")) return;
    }

    setActiveCitationLabel(null);
    setCitationTooltipPosition(null);
  }

  async function submitQuestion() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error ?? "Query failed.");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Query failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
    <main className="min-h-screen bg-[linear-gradient(180deg,#fafafa_0%,#ffffff_48%,#f6f7f8_100%)] text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-5 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-xs uppercase text-zinc-500">Retriq</p>
            <h1 className="mt-2 max-w-3xl text-3xl font-semibold text-zinc-950 md:text-5xl">
              Documentation retrieval workbench
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-md">
              RAG
            </Badge>
            <Badge variant="outline" className="rounded-md">
              Gemini
            </Badge>
            <Badge variant="outline" className="rounded-md">
              Cited answers
            </Badge>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
          <Card className="rounded-md border-zinc-200 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareText className="size-4" />
                Question
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="min-h-36 resize-none rounded-md border-zinc-300 bg-white font-mono text-sm leading-7"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-zinc-500">{question.trim().length} characters</p>
                <Button onClick={submitQuestion} disabled={isLoading || question.trim().length < 3}>
                  {isLoading ? <Loader2 className="animate-spin" /> : <FileSearch />}
                  Retrieve and answer
                </Button>
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Query unavailable</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-md border-zinc-200 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4" />
                Grounded answer
              </CardTitle>
              {result ? (
                <span className={`rounded-md px-2 py-1 text-xs font-medium ${retrievalLevel.tone}`}>
                  {retrievalLevel.label}
                </span>
              ) : null}
            </CardHeader>
            <CardContent>
              {result ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm leading-7 text-zinc-800">
                    <ReactMarkdown
                      // The generated answer is rendered as Markdown, while
                      // citations remain plain links shown below the answer.
                      components={{
                        h1: ({ children }) => <h1 className="mb-3 text-lg font-semibold text-zinc-950">{children}</h1>,
                        h2: ({ children }) => <h2 className="mb-3 text-base font-semibold text-zinc-950">{children}</h2>,
                        h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold text-zinc-950">{children}</h3>,
                        p: ({ children }) => <AnswerTextBlock>{children}</AnswerTextBlock>,
                        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
                        li: ({ children }) => (
                          <li className="rounded px-1 py-0.5 transition-colors [&:has(a[data-citation-active='true'])]:bg-amber-50">
                            {children}
                          </li>
                        ),
                        strong: ({ children }) => <strong className="font-semibold text-zinc-950">{children}</strong>,
                        code: ({ children }) => (
                          <code className="rounded border border-zinc-200 bg-white px-1 py-0.5 font-mono text-[0.85em] text-zinc-950">
                            {children}
                          </code>
                        ),
                        a: ({ children, href }) => {
                          const label = href?.startsWith("#chunk-") ? href.replace("#chunk-", "") : "";
                          const citation = citationsByLabel.get(label);
                          if (citation) {
                            return (
                              <CitationReference
                                active={activeCitationLabel === label}
                                citation={citation}
                                onClose={closeCitationTooltip}
                                onOpen={openCitationTooltip}
                              >
                                {children}
                              </CitationReference>
                            );
                          }

                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-950"
                            >
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {answerMarkdown}
                    </ReactMarkdown>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.citations.map((citation) => (
                      <CitationReference
                        key={citation.label}
                        active={activeCitationLabel === citation.label}
                        citation={citation}
                        onClose={closeCitationTooltip}
                        onOpen={openCitationTooltip}
                      >
                        {citation.label}
                        <ExternalLink className="size-3" />
                      </CitationReference>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-52 items-center justify-center rounded-md border border-dashed border-zinc-300 text-sm text-zinc-500">
                  The answer appears after retrieval.
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="rounded-md border-zinc-200 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4" />
                Retrieved documentation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result?.retrievedChunks.length ? (
                result.retrievedChunks.map((chunk) => (
                  <details
                    id={`chunk-S${chunk.rank}`}
                    key={chunk.id}
                    className={`group scroll-mt-6 rounded-md border bg-white transition-colors open:bg-zinc-50 ${
                      activeCitationLabel === `S${chunk.rank}` ? "border-amber-300 bg-amber-50/40" : "border-zinc-200"
                    }`}
                  >
                    <summary className="grid cursor-pointer gap-3 p-4 marker:text-zinc-400 sm:grid-cols-[1fr_auto] sm:items-start">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-zinc-950 px-2 font-mono text-xs font-semibold text-white">
                            S{chunk.rank}
                          </span>
                          <span className="font-medium text-zinc-950">{chunk.section}</span>
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
                          <span>{chunk.title}</span>
                          <span className="hidden h-1 w-1 rounded-full bg-zinc-300 sm:inline-block" />
                          <span>{chunk.wordCount} words</span>
                          <span className="hidden h-1 w-1 rounded-full bg-zinc-300 sm:inline-block" />
                          <span>{formatSourceHost(chunk.sourceUrl)}</span>
                        </span>
                      </span>
                      <span className="flex min-w-28 flex-col gap-1 text-left sm:text-right">
                        <span className="font-mono text-xs font-medium text-zinc-600">
                          {formatScorePercent(chunk.score)} match
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
                          <span
                            className="block h-full rounded-full bg-zinc-950"
                            style={{ width: `${Math.max(4, Math.min(100, chunk.score * 100))}%` }}
                          />
                        </span>
                      </span>
                    </summary>
                    <Separator />
                    <div className="space-y-4 p-4">
                      <div className="grid gap-3 text-xs text-zinc-500 sm:grid-cols-3">
                        <div>
                          <span className="block font-mono uppercase tracking-wide text-zinc-400">Rank</span>
                          <span className="mt-1 block font-medium text-zinc-800">#{chunk.rank}</span>
                        </div>
                        <div>
                          <span className="block font-mono uppercase tracking-wide text-zinc-400">Similarity</span>
                          <span className="mt-1 block font-medium text-zinc-800">{chunk.score.toFixed(4)}</span>
                        </div>
                        <div>
                          <span className="block font-mono uppercase tracking-wide text-zinc-400">Source</span>
                          <a
                            href={chunk.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex max-w-full items-center gap-1 truncate font-medium text-zinc-800 hover:text-zinc-950"
                          >
                            {formatSourceHost(chunk.sourceUrl)}
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        </div>
                      </div>
                      <div className="max-h-80 overflow-auto rounded-md border border-zinc-200 bg-white p-4">
                        <DocumentationMarkdown content={chunk.content} />
                      </div>
                    </div>
                  </details>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
                  Retrieved chunks will be shown here with similarity scores.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
    {activeCitation && citationTooltipPosition && typeof document !== "undefined"
      ? createPortal(
          <CitationTooltip
            refObject={citationTooltipRef}
            citation={activeCitation}
            claim={activeClaim}
            chunk={activeChunk}
            onClose={closeCitationTooltip}
            onOpen={() => {
              setActiveCitationLabel(activeCitation.label);
            }}
            position={citationTooltipPosition}
          />,
          document.body,
        )
      : null}
    </>
  );
}

function linkCitationReferences(answer: string, citationsByLabel: Map<string, Citation>) {
  const linkedBracketReferences = answer.replace(/\[((?:S\d+)(?:,\s*S\d+)*)\]/g, (match, labelsText: string) => {
    const labels = labelsText.split(",").map((label) => label.trim());
    if (!labels.every((label) => citationsByLabel.has(label))) return match;
    return labels.map((label) => `[${label}](#chunk-${label})`).join(", ");
  });

  return linkedBracketReferences.replace(/(^|[\s(,;:])S(\d+)(?=$|[\s).,;:])/g, (match, prefix: string, number: string) => {
    const label = `S${number}`;
    if (!citationsByLabel.has(label)) return match;
    return `${prefix}[${label}](#chunk-${label})`;
  });
}

function extractCitationClaims(answer: string, citationsByLabel: Map<string, Citation>) {
  const claimsByLabel = new Map<string, string>();
  const units = answer
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((unit) => unit.trim())
    .filter(Boolean);

  for (const unit of units) {
    for (const label of citationsByLabel.keys()) {
      if (claimsByLabel.has(label)) continue;
      if (!containsCitationLabel(unit, label)) continue;

      const cleaned = unit
        .replace(/\[((?:S\d+)(?:,\s*S\d+)*)\]/g, "")
        .replace(/(^|[\s(,;:])S\d+(?=$|[\s).,;:])/g, "$1")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (cleaned) claimsByLabel.set(label, cleaned);
    }
  }

  return claimsByLabel;
}

function containsCitationLabel(value: string, label: string) {
  return new RegExp(`(^|[\\s\\[(,;:])${label}(?=$|[\\s\\]).,;:])`).test(value);
}

function AnswerTextBlock({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 rounded px-1 py-0.5 transition-colors last:mb-0 [&:has(a[data-citation-active='true'])]:bg-amber-50">
      {children}
    </p>
  );
}

function CitationReference({
  active,
  citation,
  children,
  onClose,
  onOpen,
}: {
  active: boolean;
  citation: Citation;
  children: React.ReactNode;
  onClose: (event: React.FocusEvent | React.PointerEvent | React.MouseEvent) => void;
  onOpen: (label: string, element: HTMLElement) => void;
}) {
  const triggerRef = useRef<HTMLAnchorElement>(null);

  function handleOpen(event: React.FocusEvent<HTMLAnchorElement> | React.PointerEvent<HTMLAnchorElement> | React.MouseEvent<HTMLAnchorElement>) {
    onOpen(citation.label, event.currentTarget);
  }

  return (
    <a
      ref={triggerRef}
      href={`#chunk-${citation.label}`}
      className={`relative inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[0.8em] font-semibold text-zinc-950 no-underline shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 ${
        active ? "border-amber-400 bg-amber-100" : "border-zinc-300 bg-white hover:border-zinc-950"
      }`}
      data-citation-active={active ? "true" : undefined}
      data-citation-label={citation.label}
      aria-label={`${citation.label}: ${citation.title}, ${citation.section}`}
      onBlur={onClose}
      onClick={handleOpen}
      onFocus={handleOpen}
      onMouseEnter={handleOpen}
      onMouseLeave={onClose}
      onPointerEnter={handleOpen}
      onPointerLeave={onClose}
    >
      {children}
    </a>
  );
}

function CitationTooltip({
  citation,
  claim,
  chunk,
  onClose,
  onOpen,
  position,
  refObject,
}: {
  citation: Citation;
  claim?: string;
  chunk?: RetrievalResult;
  onClose: (event: React.FocusEvent | React.PointerEvent | React.MouseEvent) => void;
  onOpen: () => void;
  position: { left: number; top: number };
  refObject: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={refObject}
      className="fixed w-80 -translate-x-1/2 rounded-md border border-zinc-200 bg-white p-3 text-left font-sans text-xs font-normal leading-5 text-zinc-600 shadow-sm"
      data-citation-tooltip={citation.label}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onPointerEnter={onOpen}
      onPointerLeave={onClose}
      style={{ left: position.left, top: position.top, zIndex: 9999 }}
    >
      <div className="mb-1 flex items-center gap-1 font-mono text-[11px] font-semibold uppercase text-zinc-400">
        <Hash className="size-3" />
        {citation.label}
      </div>
      <div className="font-medium text-zinc-950">{citation.title}</div>
      <div className="mt-1">{citation.section}</div>
      {claim ? (
        <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-2 text-zinc-700">
          <span className="block font-mono text-[10px] uppercase text-zinc-400">Answer claim</span>
          <span className="mt-1 block">{claim}</span>
        </div>
      ) : null}
      {chunk ? (
        <div className="mt-2 rounded border border-amber-100 bg-amber-50 p-2 text-zinc-700">
          This citation points to the highlighted retrieved chunk below.
        </div>
      ) : null}
      <div className="mt-2 truncate font-mono text-[11px] text-zinc-500">{formatSourceHost(citation.sourceUrl)}</div>
    </div>
  );
}

function DocumentationMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className="mb-3 text-base font-semibold text-zinc-950">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 text-sm font-semibold text-zinc-950">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold text-zinc-950">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-2 text-sm font-medium text-zinc-950">{children}</h4>,
        p: ({ children }) => <p className="mb-3 text-sm leading-7 text-zinc-700 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm leading-7 text-zinc-700">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm leading-7 text-zinc-700">{children}</ol>,
        li: ({ children }) => <li className="pl-1">{children}</li>,
        pre: ({ children }) => (
          <pre className="mb-3 overflow-auto rounded-md bg-zinc-950 p-4 text-xs leading-6 text-zinc-50 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-zinc-50">
            {children}
          </pre>
        ),
        code: ({ children }) => (
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-950">{children}</code>
        ),
        strong: ({ children }) => <strong className="font-semibold text-zinc-950">{children}</strong>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function isInsufficientAnswer(answer: string) {
  const normalized = answer.toLowerCase();
  return (
    normalized.includes("cannot be fully determined") ||
    normalized.includes("cannot be determined") ||
    normalized.includes("does not contain enough information") ||
    normalized.includes("insufficient")
  );
}

function formatScorePercent(score: number) {
  return `${Math.round(score * 100)}%`;
}

function formatSourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return sourceUrl;
  }
}
