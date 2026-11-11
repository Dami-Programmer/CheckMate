// "This flag is wrong" reports. Testers send these from the popup; they help
// improve the prompt and the answer keys.

import { query } from "./db.js";
import type { Flag } from "./verify.js";

export const MAX_NOTE_LENGTH = 1000;

export class ReportError extends Error {
  constructor(
    public code: "analysis_not_found" | "flag_not_found",
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface ReportInput {
  analysisId: number;
  flag: { type: number; quote: string };
  note?: string;
}

// Saves a report. Returns { duplicate: true } if this person already reported
// the same flag, so pressing the button twice doesn't create two reports.
export async function saveReport(userId: number, input: ReportInput): Promise<{ id: number; duplicate: boolean }> {
  const analysis = await query<{ flags: Flag[] }>("SELECT flags FROM analyses WHERE id = $1", [input.analysisId]);
  const flags = analysis.rows[0]?.flags;
  if (!flags) {
    throw new ReportError("analysis_not_found", 404, "That result no longer exists. Scan the page again and retry.");
  }

  // Only flags we actually showed can be reported; store our copy of it.
  const flag = flags.find((f) => f.type === input.flag.type && f.quote === input.flag.quote);
  if (!flag) {
    throw new ReportError("flag_not_found", 400, "That flag isn't part of this result.");
  }

  const existing = await query<{ id: number }>(
    `SELECT id FROM reports
      WHERE user_id = $1 AND analysis_id = $2 AND flag->>'type' = $3 AND flag->>'quote' = $4`,
    [userId, input.analysisId, String(flag.type), flag.quote]
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, duplicate: true };

  const note = input.note?.trim().slice(0, MAX_NOTE_LENGTH) || null;
  const saved = await query<{ id: number }>(
    "INSERT INTO reports (user_id, analysis_id, flag, note) VALUES ($1, $2, $3, $4) RETURNING id",
    [userId, input.analysisId, JSON.stringify(flag), note]
  );
  return { id: saved.rows[0]!.id, duplicate: false };
}
