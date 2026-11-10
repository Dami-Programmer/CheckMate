// The full analysis: clean -> split -> AI on every chunk (in parallel)
// -> check quotes and merge duplicates -> score.

import { getAnalyzer } from "./ai.js";
import { chunkText } from "./chunk.js";
import { cleanText } from "./clean.js";
import { scoreFlags, scoreLabel } from "./score.js";
import { verifyFlags, type Flag } from "./verify.js";

export interface AnalysisResult {
  score: number;
  label: string;
  flags: Flag[];
  words: number;
  chunks: number;
}

export const MIN_WORDS = 200; // shorter than this is unlikely to be a terms page
export const MAX_WORDS = 60000; // longer than this is too slow and costly to scan

export class AnalysisError extends Error {
  constructor(public code: "too_short" | "too_long", message: string) {
    super(message);
  }
}

export async function analyzeDocument(rawText: string): Promise<AnalysisResult> {
  const text = cleanText(rawText);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) {
    throw new AnalysisError("too_short", "This page doesn't look like a terms or privacy page.");
  }
  if (words > MAX_WORDS) {
    throw new AnalysisError("too_long", "This page is too long to scan.");
  }

  const chunks = chunkText(text);
  const ai = getAnalyzer();
  const rawFlags = (await Promise.all(chunks.map((c) => ai.analyzeChunk(c)))).flat();
  const flags = verifyFlags(rawFlags, text);
  const score = scoreFlags(flags);

  return { score, label: scoreLabel(score), flags, words, chunks: chunks.length };
}
