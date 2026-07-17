import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | undefined;

export function getDatabaseSql() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when RETRIQ_VECTOR_STORE_BACKEND=postgres.");
  }
  client ??= neon(databaseUrl);
  return client;
}

export function resetDatabaseClientForTests() {
  client = undefined;
}
