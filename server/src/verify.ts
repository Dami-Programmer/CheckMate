// Makes sure every flag's quote really exists in the document, then merges
// duplicates (the same clause found in two overlapping chunks).
//
// Matching ignores small differences the AI often introduces: curly vs straight
// quotes, different dashes, and spacing. The quote we keep is always the exact
// text from the document, so the extension can highlight it on the page.

import type { RawFlag } from "./ai.js";
import { getClauseType, type FlagColor } from "./checklist.js";

// A checked flag, ready to show to the user.
export interface Flag {
  type: number;
  name: string;
  color: FlagColor;
  explanation: string;
  quote: string;
}

const MIN_QUOTE_LENGTH = 15;

// Characters treated as the same for matching.
function normalizeChar(ch: string): string {
  if ("‘’‚‛′`".includes(ch)) return "'";
  if ("“”„‟″".includes(ch)) return '"';
  if ("‐‑‒–—―−".includes(ch)) return "-";
  if (/\s/.test(ch)) return " ";
  return ch;
}

// Normalized text plus, for each normalized character, where it came from.
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = normalizeChar(text[i]);
    if (ch === " " && norm.endsWith(" ")) continue; // collapse runs of spaces
    norm += ch;
    map.push(i);
  }
  return { norm, map };
}

const normalize = (s: string) => normalizeWithMap(s).norm.trim();

// Finds the quote in the document; returns the document's exact text, or null.
export function findQuote(quote: string, doc: { text: string; norm: string; map: number[] }): string | null {
  const q = normalize(quote);
  if (q.length < MIN_QUOTE_LENGTH) return null;
  const start = doc.norm.indexOf(q);
  if (start === -1) return null;
  const from = doc.map[start];
  const to = doc.map[start + q.length - 1] + 1;
  return doc.text.slice(from, to);
}

export function verifyFlags(rawFlags: RawFlag[], text: string): Flag[] {
  const doc = { text, ...normalizeWithMap(text) };
  const kept: Flag[] = [];
  const seen = new Set<string>();

  for (const raw of rawFlags) {
    const info = getClauseType(raw.type);
    if (!info) continue;
    const exact = findQuote(raw.quote, doc);
    if (exact === null) continue; // not in the document: drop it

    // Same type and same sentence = duplicate.
    const key = `${raw.type}|${normalize(exact)}`;
    if (seen.has(key)) continue;
    // Same type and one quote contains the other = duplicate; keep the longer.
    const overlapIndex = kept.findIndex(
      (k) => k.type === raw.type && (normalize(k.quote).includes(normalize(exact)) || normalize(exact).includes(normalize(k.quote)))
    );
    if (overlapIndex !== -1) {
      if (exact.length > kept[overlapIndex].quote.length) kept[overlapIndex].quote = exact;
      continue;
    }

    seen.add(key);
    kept.push({ type: raw.type, name: info.name, color: info.color, explanation: raw.explanation, quote: exact });
  }
  return kept;
}
