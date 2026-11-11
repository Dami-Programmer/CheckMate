// Talks to the AI: sends one chunk of text plus the checklist, gets flags back.
//
// Right now only the FAKE AI exists. It finds sentences by keyword, so the rest
// of the server can be built and tested for free. When a real model is picked,
// add it here; nothing else in the server needs to change.

import { CHECKLIST } from "./checklist.js";

// One finding, as the AI reports it. Color and title come from the checklist later.
export interface RawFlag {
  type: number; // checklist id, 1-12
  explanation: string; // plain-language reason, one or two sentences
  quote: string; // the exact sentence from the text
}

export interface Analyzer {
  name: string;
  analyzeChunk(chunk: string): Promise<RawFlag[]>;
}

// ---------- Prompt (used by the real AI) ----------

export function buildPrompt(chunk: string): string {
  const types = CHECKLIST.map((t) => `${t.id}. ${t.name}: ${t.definition}`).join("\n");
  return `You review terms of service and privacy policies for ordinary people.

Find clauses in the document below that match these types:
${types}

Rules:
- Only report clauses that clearly match a type.
- "quote" must be ONE sentence copied exactly, character for character, from the document.
- "explanation" says in plain words what it means for the user, in one or two short sentences.
- If the same idea repeats, report only the clearest sentence.
- If nothing matches, return an empty list.

Reply with JSON only, in this shape:
{"flags": [{"type": 3, "explanation": "...", "quote": "..."}]}

<document>
${chunk}
</document>`;
}

// ---------- Checking the AI's reply ----------

// Turns the AI's JSON reply into flags, silently dropping anything malformed.
export function parseFlags(reply: string): RawFlag[] {
  let data: unknown;
  try {
    // Models sometimes wrap JSON in ```json fences; strip them.
    data = JSON.parse(reply.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    return [];
  }
  const list = (data as { flags?: unknown })?.flags;
  if (!Array.isArray(list)) return [];

  const validIds = new Set(CHECKLIST.map((t) => t.id));
  return list.flatMap((f): RawFlag[] => {
    if (typeof f !== "object" || f === null) return [];
    const { type, explanation, quote } = f as Record<string, unknown>;
    if (typeof type !== "number" || !validIds.has(type)) return [];
    if (typeof quote !== "string" || quote.trim() === "") return [];
    if (typeof explanation !== "string") return [];
    return [{ type, explanation: explanation.trim(), quote: quote.trim() }];
  });
}

// ---------- Fake AI ----------

const FAKE_KEYWORDS: Record<number, RegExp> = {
  1: /automatically renew|auto-renew|renews automatically/i,
  2: /non-refundable|no refund|transaction fee|default interest|penalt/i,
  3: /sell your (personal )?(data|information)|share your (personal )?(data|information)|advertis/i,
  4: /\bcontacts\b|\blocation\b|\bSMS\b|photos/i,
  5: /retain .* after|after you delete|after (account )?deletion/i,
  6: /(amend|modify|change|update) (these|this) (terms|agreement|policy)/i,
  7: /sole (and absolute )?discretion|at any time.*(suspend|terminate)|(suspend|terminate).*at any time/i,
  8: /binding arbitration|class action/i,
  9: /royalty-free|worldwide.*licen[cs]e|licen[cs]e.*worldwide/i,
  10: /collection agenc|debt collect|recovery agenc/i,
  11: /\bdebit\b|deduct|set off/i,
  12: /request (the )?deletion|delete your (account|data|personal)/i,
};

const fakeAnalyzer: Analyzer = {
  name: "fake",
  async analyzeChunk(chunk) {
    const sentences = chunk
      .split(/\n+/)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/))
      .map((s) => s.trim())
      .filter((s) => s.length > 30 && s.length < 600);

    const flags: RawFlag[] = [];
    for (const t of CHECKLIST) {
      const matches = sentences.filter((s) => FAKE_KEYWORDS[t.id]?.test(s)).slice(0, 2);
      for (const quote of matches) {
        flags.push({ type: t.id, explanation: `(Fake AI) Possible "${t.name}" clause.`, quote });
      }
    }
    return flags;
  },
};

// ---------- Choosing the AI ----------

// AI_PROVIDER in .env picks the AI. Defaults to the fake one.
export function getAnalyzer(): Analyzer {
  const provider = process.env.AI_PROVIDER ?? "fake";
  if (provider === "fake") return fakeAnalyzer;
  throw new Error(`AI provider "${provider}" is not set up yet. Use AI_PROVIDER=fake for now.`);
}
