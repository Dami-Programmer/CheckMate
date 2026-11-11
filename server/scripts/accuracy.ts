// Accuracy test: runs every test document that has an answer file through the
// analysis, then compares the AI's flags with the hand-marked answers.
//
//   npm run accuracy
//
// For each AI flag:
//   right  = same type as an answer line, and the quotes mostly overlap
//   extra  = no matching line, but the answer file has that type elsewhere
//            (answer files mark only the clearest example, so this isn't wrong)
//   wrong  = a type the answer file doesn't have at all
// For each answer line:
//   missed = no AI flag of that type overlaps it
//
// Goal: at least 90% of judged flags right (right / (right + wrong)).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocument } from "../src/analyze.js";
import type { Flag } from "../src/verify.js";

const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-documents");
const OVERLAP_NEEDED = 0.6; // share of the shorter quote's words found in the other

export interface Answer {
  type: number;
  quote: string;
}

export function parseAnswers(fileText: string): Answer[] {
  return fileText
    .split(/\r?\n/)
    .map((line) => line.match(/^\[(\d+)\]\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ type: Number(m[1]), quote: m[2]!.trim() }));
}

const wordsOf = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );

export function quotesOverlap(a: string, b: string): boolean {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= OVERLAP_NEEDED;
}

export interface DocResult {
  right: number;
  extra: number;
  wrong: number;
  missed: number;
  wrongFlags: Flag[];
  missedAnswers: Answer[];
}

export function compare(flags: Flag[], answers: Answer[]): DocResult {
  const answerTypes = new Set(answers.map((a) => a.type));
  const r: DocResult = { right: 0, extra: 0, wrong: 0, missed: 0, wrongFlags: [], missedAnswers: [] };

  for (const f of flags) {
    const matches = answers.some((a) => a.type === f.type && quotesOverlap(a.quote, f.quote));
    if (matches) r.right++;
    else if (answerTypes.has(f.type)) r.extra++;
    else {
      r.wrong++;
      r.wrongFlags.push(f);
    }
  }
  for (const a of answers) {
    const found = flags.some((f) => f.type === a.type && quotesOverlap(a.quote, f.quote));
    if (!found) {
      r.missed++;
      r.missedAnswers.push(a);
    }
  }
  return r;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`);

async function main() {
  const verbose = process.argv.includes("--details");
  const answerFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".answers.txt")).sort();
  const total = { right: 0, extra: 0, wrong: 0, missed: 0, answers: 0 };

  console.log(`AI: ${process.env.AI_PROVIDER ?? "fake"}   documents: ${answerFiles.length}\n`);
  console.log("document".padEnd(18) + "right  extra  wrong  missed");

  for (const file of answerFiles) {
    const name = file.replace(".answers.txt", "");
    const answers = parseAnswers(readFileSync(join(DOCS_DIR, file), "utf8"));
    const text = readFileSync(join(DOCS_DIR, `${name}.txt`), "utf8");
    const { flags } = await analyzeDocument(text);
    const r = compare(flags, answers);

    total.right += r.right;
    total.extra += r.extra;
    total.wrong += r.wrong;
    total.missed += r.missed;
    total.answers += answers.length;
    console.log(
      name.padEnd(18) + String(r.right).padStart(5) + String(r.extra).padStart(7) + String(r.wrong).padStart(7) + String(r.missed).padStart(8)
    );
    if (verbose) {
      for (const f of r.wrongFlags) console.log(`   wrong  [${f.type}] ${f.quote.slice(0, 90)}`);
      for (const a of r.missedAnswers) console.log(`   missed [${a.type}] ${a.quote.slice(0, 90)}`);
    }
  }

  const judged = total.right + total.wrong;
  console.log("\n" + "TOTAL".padEnd(18) + String(total.right).padStart(5) + String(total.extra).padStart(7) + String(total.wrong).padStart(7) + String(total.missed).padStart(8));
  console.log(`\nFlags right:    ${pct(total.right, judged)}  (goal: 90% or more)`);
  console.log(`Answers found:  ${pct(total.answers - total.missed, total.answers)}  (${total.answers - total.missed} of ${total.answers})`);
  console.log(judged > 0 && total.right / judged >= 0.9 ? "\nPASS" : "\nNOT YET: tune the prompt or model and run again");
}

// Run only when started directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
