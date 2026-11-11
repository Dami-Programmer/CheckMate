// Pulls the readable text out of a web page. Shared by the in-page reader
// (extract.ts) and the tests, so both use exactly the same logic.
import { Readability } from "@mozilla/readability";

export interface Extracted {
  title: string;
  text: string;
  words: number;
  method: "readability" | "whole-page";
}

const MIN_WORDS = 200; // same minimum as the server

// Tags that start a new paragraph in the text we produce.
const BLOCK = new Set(
  "ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION TABLE TBODY THEAD TFOOT TR UL".split(" ")
);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON"]);

// HTML -> plain text, keeping paragraph breaks (the server chunks on them).
export function htmlToText(root: Node): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push((node.textContent ?? "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (tag === "BR") return void parts.push("\n");
    const block = BLOCK.has(tag);
    if (block) parts.push("\n\n");
    if (tag === "TD" || tag === "TH") parts.push(" ");
    node.childNodes.forEach(walk);
    if (block) parts.push("\n\n");
  };
  walk(root);
  return parts
    .join("")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function extractFromDocument(doc: Document): Extracted {
  const title = (doc.title || "").trim();

  // 1. Readability: the main article, without menus, footers and cookie banners.
  try {
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    if (article?.content) {
      const parsed = new (doc.defaultView ?? window).DOMParser().parseFromString(article.content, "text/html");
      const text = htmlToText(parsed.body);
      const words = countWords(text);
      if (words >= MIN_WORDS) return { title: article.title?.trim() || title, text, words, method: "readability" };
    }
  } catch {
    // fall through to the whole page
  }

  // 2. Fallback: all the visible text on the page.
  const body = doc.body;
  const raw = body ? ((body as HTMLElement).innerText ?? "") || htmlToText(body) : "";
  const text = raw.replace(/\n{3,}/g, "\n\n").trim();
  return { title, text, words: countWords(text), method: "whole-page" };
}
