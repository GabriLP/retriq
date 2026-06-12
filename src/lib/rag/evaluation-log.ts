import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ragConfig } from "./config";
import type { EvaluationLogEntry, QueryResponse } from "./types";

export async function appendEvaluationLog(response: QueryResponse) {
  const entry: EvaluationLogEntry = {
    ...response,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(ragConfig.evaluationLogPath), { recursive: true });
  // JSONL keeps each interaction as an append-only record that can be imported
  // later into spreadsheets or analysis scripts without loading a full database.
  await fs.appendFile(ragConfig.evaluationLogPath, `${JSON.stringify(entry)}\n`);
}
