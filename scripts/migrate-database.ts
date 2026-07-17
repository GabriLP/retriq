import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as nextEnv from "@next/env";

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const requestedPath = path.resolve(readArg("--path", "db/migrations"));
  const { getDatabaseSql } = await import("../src/lib/rag/database");
  const sql = getDatabaseSql();
  await sql.query(`CREATE TABLE IF NOT EXISTS rag_schema_migrations (
    filename text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`, []);
  const migrationPaths = (await fs.stat(requestedPath)).isDirectory()
    ? (await fs.readdir(requestedPath)).filter((item) => item.endsWith(".sql")).sort().map((item) => path.join(requestedPath, item))
    : [requestedPath];
  for (const migrationPath of migrationPaths) {
    const migration = await fs.readFile(migrationPath, "utf8");
    const hash = sha256(migration);
    const filename = path.basename(migrationPath);
    const applied = await sql.query("SELECT sha256 FROM rag_schema_migrations WHERE filename = $1", [filename]) as unknown as Array<{ sha256: string }>;
    if (applied[0]) {
      if (applied[0].sha256 !== hash) throw new Error(`Applied migration ${filename} has changed.`);
      console.log(`Skipped ${filename}; already applied.`);
      continue;
    }
    const statements = migration.split(/^\s*-- statement-breakpoint\s*$/m).map((item) => item.trim()).filter(Boolean);
    for (let index = 0; index < statements.length; index += 1) {
      await sql.query(statements[index], []);
      console.log(`${filename}: statement ${index + 1}/${statements.length}.`);
    }
    await sql.query("INSERT INTO rag_schema_migrations (filename, sha256) VALUES ($1, $2)", [filename, hash]);
  }
  console.log(`Migration complete: ${path.relative(process.cwd(), requestedPath)}.`);
}

function readArg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

main().catch((error) => { console.error(error); process.exit(1); });
