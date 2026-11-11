// Daily limits. Only NEW scans count: results that come from the shared cache
// are free and unlimited.
//   - each person: 15 new scans per day
//   - whole server: 200 new scans per day (protects the AI bill)
// Days are counted in the database's time zone (UTC), so they reset at
// midnight UTC (1 am in Lagos).

import { query } from "./db.js";

export const USER_DAILY_LIMIT = Number(process.env.USER_DAILY_LIMIT ?? 15);
export const SERVER_DAILY_LIMIT = Number(process.env.SERVER_DAILY_LIMIT ?? 200);

export class LimitError extends Error {
  constructor(
    public code: "daily_limit" | "server_busy",
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// Takes one of today's scan slots for this person, or throws LimitError.
// The person's count is checked and increased in ONE database statement, so
// two scans sent at the same moment can't sneak past the limit.
export async function reserveScan(userId: number): Promise<void> {
  const total = await query<{ n: number }>(
    "SELECT COALESCE(SUM(new_analyses), 0)::int AS n FROM usage WHERE date = CURRENT_DATE"
  );
  if ((total.rows[0]?.n ?? 0) >= SERVER_DAILY_LIMIT) {
    throw new LimitError(
      "server_busy",
      503,
      "CheckMate has reached its limit for today. Pages others already scanned still work. Please try again tomorrow."
    );
  }

  const r = await query(
    `INSERT INTO usage (user_id, date, new_analyses) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, date) DO UPDATE SET new_analyses = usage.new_analyses + 1
       WHERE usage.new_analyses < $2
     RETURNING new_analyses`,
    [userId, USER_DAILY_LIMIT]
  );
  if (r.rowCount === 0) {
    throw new LimitError(
      "daily_limit",
      429,
      `You've used your ${USER_DAILY_LIMIT} new scans for today. Pages others already scanned still work. Your scans reset at midnight UTC.`
    );
  }
}

// How many new scans this person has left today (shown in the popup).
export async function scansLeftToday(userId: number): Promise<number> {
  const r = await query<{ new_analyses: number }>(
    "SELECT new_analyses FROM usage WHERE user_id = $1 AND date = CURRENT_DATE",
    [userId]
  );
  return Math.max(0, USER_DAILY_LIMIT - (r.rows[0]?.new_analyses ?? 0));
}

// Gives the slot back when a scan fails (e.g. the page was too short).
export async function releaseScan(userId: number): Promise<void> {
  await query(
    "UPDATE usage SET new_analyses = new_analyses - 1 WHERE user_id = $1 AND date = CURRENT_DATE AND new_analyses > 0",
    [userId]
  );
}
