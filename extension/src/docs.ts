// Reads the text out of an uploaded document, entirely inside the browser.
// PDF (pdf.js), Word .docx (unzip + its XML) and plain text.
//
// The result is a list of blocks (paragraphs and headings). The SAME text is
// shown on the upload page and sent to be checked, so every flagged quote can
// be found and highlighted on screen.
import { strFromU8, unzipSync } from "fflate";

export interface Block {
  kind: "p" | "h";
  text: string;
}
export interface DocText {
  name: string;
  type: "PDF" | "Word" | "Text";
  pages?: number;
  emptyPages?: number[]; // PDF pages with no readable text (blank, or a scanned picture)
  blocks: Block[];
  text: string; // blocks joined by blank lines: exactly what gets checked
  words: number;
}

export const MAX_BYTES = 15 * 1024 * 1024;
export const MIN_WORDS = 200; // same rules as the server
export const MAX_WORDS = 60000;

export class DocError extends Error {}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
const tidy = (s: string) => s.replace(/[ \t ]+/g, " ").trim();

export async function readDocument(file: File): Promise<DocText> {
  const name = file.name || "Document";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (file.size > MAX_BYTES) throw new DocError("This file is bigger than 15 MB. Try a smaller copy of the document.");
  if (ext === "doc") throw new DocError("Old Word files (.doc) aren't supported. Open it in Word and save it as .docx or PDF, then upload that.");

  let doc: Omit<DocText, "text" | "words">;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = ext === "pdf" || file.type === "application/pdf" || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isPdf) doc = { name, type: "PDF", ...(await readPdf(bytes)) };
  else if (ext === "docx" || isZip) doc = { name, type: "Word", blocks: readDocx(bytes) };
  else if (ext === "txt" || ext === "md" || file.type.startsWith("text/") || looksLikeText(bytes)) doc = { name, type: "Text", blocks: readTxt(bytes) };
  else throw new DocError("CheckMate can read PDF, Word (.docx) and text (.txt) files. Save the document in one of those and try again.");

  const blocks = doc.blocks.filter((b) => b.text);
  const text = blocks.map((b) => b.text).join("\n\n");
  const words = countWords(text);
  if (doc.type === "PDF" && doc.pages && words / doc.pages < 25) {
    throw new DocError("This PDF looks like scanned pictures of pages, so there's no text to read. Try a PDF you can select text in, or a Word copy.");
  }
  if (words < MIN_WORDS) throw new DocError(`This document is too short to check (${words} words). Upload the full terms, contract or privacy policy.`);
  if (words > MAX_WORDS) throw new DocError(`This document is too long to check (${words.toLocaleString()} words; the limit is ${MAX_WORDS.toLocaleString()}). Try uploading just the terms part.`);
  return { ...doc, blocks, text, words };
}

// ---------- Plain text ----------
function looksLikeText(bytes: Uint8Array) {
  const head = bytes.subarray(0, 2000);
  return head.length > 0 && !head.includes(0);
}
function readTxt(bytes: Uint8Array): Block[] {
  const raw = new TextDecoder("utf-8").decode(bytes).replace(/\r\n?/g, "\n");
  // Blank lines separate paragraphs. If there are none, every line is its own paragraph.
  const parts = /\n\s*\n/.test(raw) ? raw.split(/\n\s*\n/).map((p) => p.replace(/\n/g, " ")) : raw.split("\n");
  return parts.map((p) => ({ kind: "p" as const, text: tidy(p) }));
}

// ---------- Word (.docx) ----------
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function readDocx(bytes: Uint8Array): Block[] {
  let xml: string;
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
    const data = files["word/document.xml"];
    if (!data) throw new Error("no document.xml");
    xml = strFromU8(data);
  } catch {
    throw new DocError("This doesn't look like a Word (.docx) file CheckMate can open. Try saving it again as .docx or PDF.");
  }
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  if (dom.getElementsByTagName("parsererror").length) throw new DocError("This Word file looks damaged. Try saving it again as .docx or PDF.");

  // Text of one paragraph, without the text of paragraphs nested inside it (text boxes), which are read on their own.
  const textOf = (p: Element) => {
    let out = "";
    const walk = (el: Element) => {
      for (const c of Array.from(el.children)) {
        if (c.namespaceURI !== W) {
          walk(c);
          continue;
        }
        const n = c.localName;
        if (n === "p" || n === "delText" || n === "instrText") continue; // nested paragraph, deleted text, field codes
        if (n === "t") out += c.textContent ?? "";
        else if (n === "tab" || n === "br" || n === "cr") out += " ";
        else walk(c);
      }
    };
    walk(p);
    return tidy(out);
  };
  return Array.from(dom.getElementsByTagNameNS(W, "p")).map((p) => {
    const style = p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") ?? p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttribute("w:val") ?? "";
    return { kind: /^(heading|title)/i.test(style) ? "h" : "p", text: textOf(p) };
  });
}

// ---------- PDF ----------
async function readPdf(bytes: Uint8Array): Promise<{ blocks: Block[]; pages: number; emptyPages: number[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.js");
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: bytes, verbosity: pdfjs.VerbosityLevel.ERRORS, useWasm: false, disableFontFace: true, useSystemFonts: false }).promise;
  } catch (err) {
    if ((err as { name?: string })?.name === "PasswordException") throw new DocError("This PDF is password-protected. Remove the password (or print it to a new PDF) and try again.");
    throw new DocError("CheckMate couldn't open this PDF. It may be damaged. Try saving or exporting it again.");
  }

  interface Line {
    text: string;
    y: number;
    size: number;
    width: number;
    page: number;
  }
  // 1. Every page's text items -> lines
  const all: Line[] = [];
  const emptyPages: number[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines: Line[] = [];
    let cur: Line | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5] as number;
      const size = Math.abs((item.transform[3] as number) || item.height || 10);
      if (!cur) cur = { text: "", y, size, width: 0, page: n };
      else if (Math.abs(y - cur.y) > size * 0.5 && item.str.trim()) {
        lines.push(cur); // a new line started without an end-of-line marker
        cur = { text: "", y, size, width: 0, page: n };
      }
      cur.text += item.str;
      cur.width += item.width || 0;
      cur.size = Math.max(cur.size, size);
      if (item.hasEOL) {
        lines.push(cur);
        cur = null;
      }
    }
    if (cur) lines.push(cur);
    const before = all.length;
    for (const l of lines) {
      const text = tidy(l.text);
      if (text && !/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(text)) all.push({ ...l, text }); // drop page numbers
    }
    const pageWords = all.slice(before).reduce((n, l) => n + countWords(l.text), 0);
    if (pageWords < 5) emptyPages.push(n);
  }

  // 2. Lines -> paragraphs and headings
  const blocks: Block[] = [];
  if (all.length) {
    const sizes = all.map((l) => l.size).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)]!;
    const widths = all.map((l) => l.width).sort((a, b) => a - b);
    const full = widths[Math.floor(widths.length * 0.9)] || 0; // a typical full line
    const startsClause = (s: string) => /^(\(?\d+(\.\d+)*[.)]|\(?[a-z][.)]|\([ivx]+\)|[IVX]+\.)\s+\S/.test(s); // "4. ", "(2) ", "b. ", "(iv) "
    let para: Line[] = [];
    const flush = () => {
      if (!para.length) return;
      let text = "";
      for (const l of para) {
        if (!text) text = l.text;
        else if (/[a-z]-$/i.test(text) && /^[a-z]/.test(l.text)) text = text.slice(0, -1) + l.text; // "compen-" + "sation"
        else text += " " + l.text;
      }
      const big = para.every((l) => l.size > body * 1.15);
      const shortText = text.length < 100 && !/[.;,:]$/.test(text);
      const heading = shortText && (big || (/[A-Z]/.test(text) && text === text.toUpperCase()) || (para.length === 1 && startsClause(text)));
      blocks.push({ kind: heading ? "h" : "p", text });
      para = [];
    };
    for (let i = 0; i < all.length; i++) {
      const l = all[i]!;
      const prev = all[i - 1];
      if (prev) {
        const shortPrev = full > 0 && prev.width < full * 0.72 && !/-$/.test(prev.text); // a paragraph's last line ends early
        const sizeChange = Math.abs(prev.size - l.size) > body * 0.15;
        // On the same page a bigger gap than usual also starts a block; across a page break the paragraph just continues.
        const bigGap = prev.page === l.page && Math.abs(prev.y - l.y) > Math.max(prev.size, l.size) * 1.75;
        if (bigGap || sizeChange || shortPrev || startsClause(l.text)) flush();
      }
      para.push(l);
    }
    flush();
  }
  const pages = pdf.numPages;
  await pdf.loadingTask.destroy();
  return { blocks, pages, emptyPages };
}
