import * as nextEnv from "@next/env";

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const { getDatabaseSql } = await import("../src/lib/rag/database");
  const sql = getDatabaseSql();
  const [versions, storage] = await Promise.all([
    sql.query(`SELECT v.id, v.status, v.is_active, v.chunk_count AS expected_chunks,
                      COUNT(c.*)::bigint AS stored_chunks
               FROM rag_corpus_versions v
               LEFT JOIN rag_chunks c ON c.corpus_version_id = v.id
               GROUP BY v.id ORDER BY v.created_at`, []),
    sql.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size,
                      (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vector_version`, []),
  ]);
  console.log(JSON.stringify({ versions, storage: storage[0] }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
