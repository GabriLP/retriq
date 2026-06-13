import { NextResponse } from "next/server";

import { ragConfig } from "@/lib/rag/config";
import { answerQuestion } from "@/lib/rag/pipeline";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: unknown; topK?: unknown };
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const topK = typeof body.topK === "number" ? body.topK : ragConfig.defaultTopK;

    if (question.length < 3) {
      return NextResponse.json({ error: "Question must contain at least 3 characters." }, { status: 400 });
    }

    const response = await answerQuestion(question, topK);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected query failure.";
    const status = message.includes("GEMINI_API_KEY") || message.includes("ENOENT") ? 503 : 500;

    return NextResponse.json(
      {
        error: message,
        recovery:
          status === 503
            ? "Create .env.local from .env.example, run npm run ingest -- --source <docs>, then restart the dev server."
            : "Inspect the server logs for details.",
      },
      { status },
    );
  }
}
