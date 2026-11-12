// Runs INSIDE the web page (in the floating panel's script).
//
// It finds each flagged quote in the page text and highlights it with the CSS
// Custom Highlight API, which colours text WITHOUT changing the page's HTML.
// If `focus` is given, that quote is highlighted strongly and scrolled into view.

export interface HighlightItem {
  quote: string;
  color: "red" | "orange" | "green";
}

export interface HighlightResult {
  found: boolean[]; // one per item
  focus: "shown" | "hidden" | "not_found" | null;
}

const HIGHLIGHT_CSS = `
  ::highlight(checkmate-red) { background-color: rgba(220, 50, 50, 0.22); }
  ::highlight(checkmate-orange) { background-color: rgba(230, 140, 20, 0.25); }
  ::highlight(checkmate-green) { background-color: rgba(40, 160, 90, 0.22); }
  ::highlight(checkmate-focus) { background-color: rgba(255, 214, 0, 0.75); color: #111; }
`;

// The highlight colours must live in the page's own style scope. A constructed
// stylesheet isn't blocked by a page's strict "style-src" rules the way an
// inline <style> element can be; fall back to <style> only if it isn't available.
function ensureHighlightStyles() {
  try {
    const sheets = document.adoptedStyleSheets as unknown as { __checkmate?: boolean }[];
    if (sheets.some((sh) => sh.__checkmate)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HIGHLIGHT_CSS);
    (sheet as unknown as { __checkmate?: boolean }).__checkmate = true;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return;
  } catch {
    /* older Chrome: fall back to a <style> element */
  }
  if (!document.getElementById("checkmate-highlight-style")) {
    const style = document.createElement("style");
    style.id = "checkmate-highlight-style";
    style.textContent = HIGHLIGHT_CSS;
    (document.head ?? document.documentElement).appendChild(style);
  }
}

// Finds each quote in the page text. Returns a Range per quote, or null if not found.
export function findRanges(quotes: string[]): (Range | null)[] {
  // Same character clean-up as the server's quote check: curly quotes and
  // dashes become plain ones, and case is ignored. ALL whitespace is dropped,
  // because the page and the scanned text break lines differently.
  const norm = (c: string) =>
    c
      .replace(/[‘’‚‛′]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/[‐-―−]/g, "-")
      .toLowerCase();
  const isSpace = (c: string) => /\s/.test(c) || c === " " || c === "​" || c === "‌" || c === "‍" || c === "﻿";

  // 1. Index every visible-ish text character on the page.
  const nodes: Text[] = [];
  const nodeOf: number[] = [];
  const offsetOf: number[] = [];
  const hay: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const tag = n.parentElement?.tagName;
      return !tag || tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE"
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const t = n.data;
    const idx = nodes.push(n) - 1;
    for (let i = 0; i < t.length; i++) {
      const c = t[i]!;
      if (isSpace(c)) continue;
      hay.push(norm(c));
      nodeOf.push(idx);
      offsetOf.push(i);
    }
  }
  const text = hay.join("");

  // 2. Find each quote. If the whole quote isn't there, try its beginning.
  const findRange = (quote: string): Range | null => {
    const q = [...quote].filter((c) => !isSpace(c)).map(norm).join("");
    if (q.length < 10) return null;
    let at = text.indexOf(q);
    let len = q.length;
    if (at < 0) {
      len = Math.min(q.length, 60);
      at = text.indexOf(q.slice(0, len));
      if (at < 0) return null;
    }
    const end = at + len - 1;
    const r = document.createRange();
    r.setStart(nodes[nodeOf[at]!]!, offsetOf[at]!);
    r.setEnd(nodes[nodeOf[end]!]!, offsetOf[end]! + 1);
    return r;
  };
  return quotes.map(findRange);
}

export function highlightOnPage(items: HighlightItem[], focus: number | null): HighlightResult {
  const ranges = findRanges(items.map((it) => it.quote));

  // 3. Colour them. One-time stylesheet for the highlight colours.
  ensureHighlightStyles();
  const H = (globalThis as any).Highlight;
  const registry = (CSS as any).highlights;
  if (H && registry) {
    for (const color of ["red", "orange", "green"] as const) {
      const rs = ranges.filter((r, i): r is Range => r !== null && items[i]!.color === color);
      registry.set(`checkmate-${color}`, new H(...rs));
    }
    registry.delete("checkmate-focus");
  }

  // 4. Scroll to the one the person clicked.
  let focusResult: HighlightResult["focus"] = null;
  if (focus !== null) {
    const r = ranges[focus];
    if (!r) focusResult = "not_found";
    else {
      // Open any closed <details> around it so it can be seen.
      for (let el = r.startContainer.parentElement; el; el = el.parentElement) {
        if (el.tagName === "DETAILS" && !(el as HTMLDetailsElement).open) (el as HTMLDetailsElement).open = true;
      }
      if (H && registry) registry.set("checkmate-focus", new H(r));
      const rect = r.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) focusResult = "hidden";
      else {
        r.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
        focusResult = "shown";
      }
    }
  }

  return { found: ranges.map((r) => r !== null), focus: focusResult };
}
