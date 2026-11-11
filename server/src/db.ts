// The server's connection to the database.
//
// One shared "pool" of connections is reused by every request, instead of
// opening a new connection each time. It's created the first time it's needed.

import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is missing. Add it to server/.env.");
    }
    pool = new pg.Pool({
      connectionString,
      max: 5, // small: Neon's free plan and serverless hosting prefer few connections
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

// Run one SQL query. Always pass values as params ($1, $2, ...), never by
// pasting them into the SQL text; that keeps user input from becoming SQL.
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

// True if the database answers.
export async function checkDb(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// Close all connections (used by scripts and tests when they finish).
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
