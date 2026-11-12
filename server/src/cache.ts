// Shared cache: a page that anyone has already scanned comes back instantly,
// for free, for everyone.
//
// Pages are matched by a fingerprint (SHA-256 hash) of their CLEANED text, so
// the same terms on a different URL, or with different spacing, still match.
// Results are also tied to ANALYSIS_VERSION: when the prompt, checklist or AI
// changes, the version changes and pages get scanned fresh.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { analyzeDocument, type AnalysisResult } from "./analyze.js";
import { buildPrompt, getAnalyzer } from "./ai.js";
import { CHECKLIST } from "./checklist.js";
import { cleanText } from "./clean.js";
import { query } from "./db.js";
import { scoreLabel } from "./score.js";
import type { Flag } from "./verify.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// The fingerprint ignores ALL spacing and line breaks: different browsers break
// the same page into lines differently, and that shouldn't cause a new scan.
export const hashText = (text: string) => sha256(text.replace(/\s+/g, " ").trim());

// e.g. "fake-3f9a1c2b": the AI's name + a fingerprint of the prompt and checklist.
export function analysisVersion(): string {
  const fingerprint = sha256(buildPrompt("") + JSON.stringify(CHECKLIST)).slice(0, 8);
  return `${getAnalyzer().name}-${fingerprint}`;
}

// Uploaded files can be private, so their findings (which quote the document) are saved LOCKED.
// The key is made from the document's own text, which the server doesn't keep: only someone
// who uploads the exact same document again can unlock them, and they already have those words.
// (The key is a different fingerprint from text_hash, so the saved hash can't unlock anything.)
type SavedFlags = Flag[] | { sealed: string };
const keyFor = (text: string) => createHash("sha256").update("checkmate-upload-key:" + text.replace(/\s+/g, " ").trim()).digest();
function seal(flags: Flag[], text: string): { sealed: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(text), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(flags), "utf8"), cipher.final()]);
  return { sealed: Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64") };
}
function unseal(saved: SavedFlags, text: string): Flag[] {
  if (Array.isArray(saved)) return saved;
  const raw = Buffer.from(saved.sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(text), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
}

export interface CachedResult extends AnalysisResult {
  cached: boolean;
  analysisId: number;
}

// Optional hooks that run only when a page is NOT in the cache (used for daily limits).
export interface NewScanHooks {
  beforeNewScan?: () => Promise<void>; // may throw to stop the scan
  onNewScanFailed?: () => Promise<void>;
}

// keepText: false for uploaded files (they can be private): only the fingerprint and the result are saved.
export async function analyzeWithCache(rawText: string, url?: string, hooks: NewScanHooks = {}, opts: { keepText?: boolean } = {}): Promise<CachedResult> {
  const text = cleanText(rawText);
  const hash = hashText(text);
  const version = analysisVersion();

  // 1. Seen before? Return the saved result.
  const hit = await query<{ id: number; flags: SavedFlags; score: number }>(
    `SELECT a.id, a.flags, a.score
       FROM analyses a JOIN documents d ON d.id = a.document_id
      WHERE d.text_hash = $1 AND a.analysis_version = $2`,
    [hash, version]
  );
  if (hit.rows[0]) {
    const { id, flags, score } = hit.rows[0];
    const words = text.split(/\s+/).filter(Boolean).length;
    return { score, label: scoreLabel(score), flags: unseal(flags, text), words, chunks: 0, cached: true, analysisId: id };
  }

  // 2. New: analyze it (this also rejects pages that are too short or too long).
  await hooks.beforeNewScan?.();
  let result;
  try {
    result = await analyzeDocument(text);
  } catch (err) {
    await hooks.onNewScanFailed?.();
    throw err;
  }

  // 3. Save it for everyone. If two people scan the same new page at the same
  //    moment, the second save is skipped and both get a valid result.
  const doc = await query<{ id: number }>(
    `INSERT INTO documents (url, text_hash, text) VALUES ($1, $2, $3)
     ON CONFLICT (text_hash) DO UPDATE SET text_hash = EXCLUDED.text_hash
     RETURNING id`,
    [url ?? null, hash, opts.keepText === false ? "" : text]
  );
  const saved = await query<{ id: number }>(
    `INSERT INTO analyses (document_id, analysis_version, flags, score) VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, analysis_version) DO UPDATE SET document_id = EXCLUDED.document_id
     RETURNING id`,
    [doc.rows[0]!.id, version, JSON.stringify(opts.keepText === false ? seal(result.flags, text) : result.flags), result.score]
  );

  return { ...result, cached: false, analysisId: saved.rows[0]!.id };
}
