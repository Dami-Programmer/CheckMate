// Small UI pieces shared by the popup and the floating panel.
import type { AnalyzeResult, Flag } from "./api.js";

// Builds an element. Text always goes in as text (never HTML), so nothing from
// a web page or the server can inject code.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Omit<Partial<HTMLElementTagNameMap[K]>, "style"> & { class?: string; style?: string },
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, style, ...rest } = props ?? {};
  if (cls) el.className = cls;
  if (style) el.style.cssText = style; // CSSOM, so a page's strict style rules can't block it
  Object.assign(el, rest);
  el.append(...children);
  return el;
}

export const scoreClass = (score: number) => (score >= 8 ? "good" : score >= 5 ? "mid" : "bad");

// One card per clause type (the score counts each type once), listing every place it appears.
export interface FlagGroup {
  type: number;
  name: string;
  color: Flag["color"];
  explanation: string;
  quotes: string[];
}

const COLOR_ORDER: Record<Flag["color"], number> = { red: 0, orange: 1, green: 2 };
export const COLOR_WORDS: Record<Flag["color"], string> = { red: "Watch out", orange: "Worth knowing", green: "Good for you" };

export function groupFlags(flags: Flag[]): FlagGroup[] {
  const groups = new Map<number, FlagGroup>();
  for (const f of flags) {
    const g = groups.get(f.type);
    if (g) g.quotes.push(f.quote);
    else groups.set(f.type, { type: f.type, name: f.name, color: f.color, explanation: f.explanation, quotes: [f.quote] });
  }
  return [...groups.values()].sort((a, b) => COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || a.type - b.type);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function summaryLine(groups: FlagGroup[]) {
  const risky = groups.filter((g) => g.color !== "green").length;
  const good = groups.length - risky;
  if (groups.length === 0) return "No risky clauses found.";
  const parts = [];
  if (risky) parts.push(`${plural(risky, "thing")} to watch`);
  if (good) parts.push(plural(good, "good sign"));
  return parts.join(" and ") + ".";
}

export function scoreCard(result: AnalyzeResult, extraClass = "") {
  return h(
    "div",
    { class: `score-card ${scoreClass(result.score)} ${extraClass}`.trim() },
    h("div", { class: "score" }, h("span", { class: "num" }, String(result.score)), h("span", { class: "of" }, "/10")),
    h(
      "div",
      {},
      h("div", { class: "label" }, result.label),
      h("div", { class: "muted small" }, summaryLine(groupFlags(result.flags))),
      result.cached ? h("div", { class: "muted small" }, "Already scanned by someone: instant and free.") : ""
    )
  );
}

// Adds our stylesheet to a shadow root. A constructed stylesheet isn't blocked
// by a page's strict "style-src" rules the way an inline <style> element can be.
export function applyCss(root: ShadowRoot | Document, css: string) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  } catch {
    /* older Chrome: fall back to a <style> element */
  }
  const style = document.createElement("style");
  style.textContent = css;
  (root instanceof Document ? root.head : root).append(style);
}
