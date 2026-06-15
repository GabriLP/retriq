"use client";

import { useMemo, useState } from "react";
import { BookOpen, ExternalLink, FileSearch, Loader2, MessageSquareText, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { QueryResponse } from "@/lib/rag/types";

const starterQuestion = "How should I choose between client and server components?";

export function QueryWorkbench() {
  const [question, setQuestion] = useState(starterQuestion);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const retrievalLevel = useMemo(() => {
    const topScore = result?.retrievedChunks[0]?.score ?? 0;
    if (topScore >= 0.55) return { label: "High match", tone: "bg-emerald-100 text-emerald-800" };
    if (topScore >= 0.32) return { label: "Partial match", tone: "bg-amber-100 text-amber-800" };
    return { label: "Weak match", tone: "bg-zinc-100 text-zinc-700" };
  }, [result]);

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
                  <div className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm leading-7 text-zinc-800">
                    {result.answer}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.citations.map((citation) => (
                      <a
                        key={citation.label}
                        href={citation.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        {citation.label}
                        <ExternalLink className="size-3" />
                      </a>
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
                  <details key={chunk.id} className="group rounded-md border border-zinc-200 bg-white p-4 open:bg-zinc-50">
                    <summary className="grid cursor-pointer gap-2 marker:text-zinc-400 sm:grid-cols-[1fr_auto] sm:items-center">
                      <span>
                        <span className="font-medium text-zinc-950">
                          S{chunk.rank}. {chunk.section}
                        </span>
                        <span className="mt-1 block text-sm text-zinc-500">{chunk.title}</span>
                      </span>
                      <span className="font-mono text-xs text-zinc-500">score {chunk.score}</span>
                    </summary>
                    <Separator className="my-3" />
                    <p className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-7 text-zinc-700">
                      {chunk.content}
                    </p>
                    <a
                      href={chunk.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-950"
                    >
                      Open source <ExternalLink className="size-3" />
                    </a>
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
  );
}
