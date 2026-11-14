// How long CheckMate keeps things, and the clean-up that enforces it.
// These numbers are also written on the public privacy page (public/privacy.html):
// change both together.

import { query } from "./db.js";

export const RETENTION = {
  usageDays: 30, // daily scan counts (used for the daily limit)
  reportMonths: 12, // "This flag is wrong" reports
  uploadDays: 90, // the fingerprint + locked findings of an uploaded document
} as const;

const EVERY_MS = 60 * 60 * 1000; // at most once an hour per server instance
let lastRun = 0;

// Deletes everything past its time. Runs inside normal requests (Vercel has no
// always-on process); it never throws, so it can't break the request it rides on.
export async function cleanUpIfDue(now = Date.now()): Promise<void> {
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;
  try {
    await cleanUp();
  } catch (err) {
    console.error("CheckMate clean-up failed (will retry later)", err);
  }
}

export async function cleanUp(): Promise<{ usage: number; reports: number; uploads: number }> {
  const usage = await query("DELETE FROM usage WHERE date < CURRENT_DATE - $1::int", [RETENTION.usageDays]);
  const reports = await query("DELETE FROM reports WHERE created_at < NOW() - make_interval(months => $1::int)", [RETENTION.reportMonths]);
  // Upload records: no address and no text (see cache.ts). Reports can't point at them (reports.ts refuses).
  const old = `SELECT id FROM documents WHERE url IS NULL AND text = '' AND first_seen < NOW() - make_interval(days => $1::int)`;
  await query(`DELETE FROM analyses WHERE document_id IN (${old})`, [RETENTION.uploadDays]);
  const uploads = await query(`DELETE FROM documents WHERE id IN (${old})`, [RETENTION.uploadDays]);
  return { usage: usage.rowCount ?? 0, reports: reports.rowCount ?? 0, uploads: uploads.rowCount ?? 0 };
}

// "Delete my data": this person's reports and their past scan history.
// Today's scan count stays until it ages out, so deleting can't be used to get extra scans.
export async function deleteUserData(userId: number): Promise<{ reports: number; days: number }> {
  const reports = await query("DELETE FROM reports WHERE user_id = $1", [userId]);
  const days = await query("DELETE FROM usage WHERE user_id = $1 AND date < CURRENT_DATE", [userId]);
  return { reports: reports.rowCount ?? 0, days: days.rowCount ?? 0 };
}

// "Forget this document": removes an uploaded document's record, found by its fingerprint.
// Only upload records (no address, no text) can be removed, never a public page's shared cache entry.
export async function forgetUpload(textHash: string): Promise<boolean> {
  const doc = await query<{ id: number }>("SELECT id FROM documents WHERE text_hash = $1 AND url IS NULL AND text = ''", [textHash]);
  const id = doc.rows[0]?.id;
  if (!id) return false;
  await query("DELETE FROM analyses WHERE document_id = $1", [id]);
  await query("DELETE FROM documents WHERE id = $1", [id]);
  return true;
}
