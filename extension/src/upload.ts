// The "Upload a document" page (opened from the popup in its own tab).
// The file is read right here in the browser; only its text is sent to be
// checked. The text is shown on the page and the floating panel (the same one
// used on websites) shows results, highlights and "Explain simply" on it.
import { DocError, readDocument, type DocText } from "./docs.js";
import { createMascot } from "./mascot.js";
import mascotCss from "./mascot.css";
import "./panel.js"; // registers the floating panel (__checkmatePanel) on this page
import { clearScanState, stateKey, type ScanRequest, type ScanState } from "./scan-state.js";
import { getSaved } from "./storage.js";
import { applyCss, h } from "./ui.js";

applyCss(document, mascotCss);
(globalThis as any).__checkmateDoc = true; // the panel words its steps for a document
const app = document.getElementById("app")!;
const panel = () => (globalThis as any).__checkmatePanel as { open: (id: number) => Promise<void>; close: () => void; isOpen: () => boolean };

const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
} as const;
function icon(name: keyof typeof ICONS) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name]; // our own constants
  return svg;
}
const brand = () => h("div", { class: "brand" }, h("span", { class: "logo" }, icon("check")), h("span", { class: "wordmark" }, "Check", h("span", {}, "Mate")));
const btn = (label: string, kind: "primary" | "secondary", ic?: keyof typeof ICONS) => h("button", { type: "button", class: `btn btn-${kind}` }, ...(ic ? [icon(ic)] : []), label);

let tabId: number | undefined;
let busy = false;
let stopWatching = () => {}; // stops following the current document's scan

const pageList = (pages: number[]) => {
  const p = pages.slice(0, 6);
  const words = p.length === 1 ? `Page ${p[0]}` : `Pages ${p.slice(0, -1).join(", ")} and ${p[p.length - 1]}`;
  return pages.length > 6 ? `${words} (and ${pages.length - 6} more)` : words;
};

// ---------- Screen 1: pick a file ----------
function showPick(error = "") {
  busy = false;
  stopWatching();
  document.title = "Upload a document · CheckMate";
  panel().close();
  const input = h("input", { type: "file", accept: ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain", hidden: true }) as HTMLInputElement;
  const choose = btn("Choose a file", "primary", "upload");
  choose.addEventListener("click", () => input.click());
  input.addEventListener("change", () => input.files?.[0] && handle(input.files[0]));

  const mascot = createMascot();
  const drop = h(
    "section",
    { class: "drop", tabIndex: 0, ariaLabel: "Drop a document here, or press Enter to choose a file" },
    h("div", { class: "drop-art" }, mascot.el),
    h("p", { class: "drop-title" }, "Drop your document here"),
    h("p", { class: "drop-sub" }, "or"),
    choose,
    h("p", { class: "formats" }, "PDF, Word (.docx) or text (.txt) · up to 15 MB"),
    input
  );
  drop.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === drop) {
      e.preventDefault();
      input.click();
    }
  });

  app.replaceChildren(
    h("header", { class: "top" }, brand()),
    h(
      "main",
      { class: "pick" },
      h("span", { class: "pill-chip" }, "Documents"),
      h("h1", {}, "Check a document"),
      h("p", { class: "lead" }, "Got terms, a contract or a privacy policy as a file? Upload it and CheckMate flags the risky parts in plain words."),
      drop,
      h("p", { class: "fit" }, h("b", {}, "Works best with "), "terms of service, privacy policies, subscriptions, and loan or credit agreements. Other contracts (jobs, rentals, NDAs) can be checked too, but CheckMate may miss risks that are special to them."),
      error ? h("div", { class: "problem", role: "alert" }, icon("alert"), h("p", {}, error)) : "",
      h("p", { class: "privacy" }, icon("lock"), h("span", {}, "Your file never leaves your computer. CheckMate reads it here and only its text is checked; uploaded text isn’t kept.")),
      h("p", { class: "legal" }, "This explains the terms; it is not legal advice.")
    )
  );
  mascot.setMode("idle");
}

// ---------- Reading ----------
async function handle(file: File) {
  if (busy) return;
  busy = true;
  const mascot = createMascot();
  app.querySelector(".drop")?.replaceChildren(
    h("div", { class: "drop-art" }, mascot.el),
    h("p", { class: "drop-title" }, "Reading ", h("span", { class: "fname" }, file.name), "…"),
    h("p", { class: "formats" }, "This stays on your computer.")
  );
  app.querySelector(".problem")?.remove();
  mascot.setMode("running");
  let doc: DocText;
  try {
    doc = await readDocument(file);
  } catch (err) {
    console.warn("CheckMate couldn't read the file", err);
    showPick(err instanceof DocError ? err.message : "CheckMate couldn't read this file. Try saving it again as PDF or .docx.");
    return;
  }
  if (!(await getSaved())) {
    showPick("Enter your invite code first: click the CheckMate icon in Chrome’s toolbar, then come back here.");
    return;
  }
  showDoc(doc);
  await scan(doc);
}

// ---------- Screen 2: the document + the floating panel ----------
function showDoc(doc: DocText) {
  document.title = `${doc.name} · CheckMate`;
  const again = btn("Upload another", "secondary", "upload");
  again.addEventListener("click", () => showPick());
  const results = btn("Show results", "primary", "panel");
  results.addEventListener("click", () => tabId !== undefined && panel().open(tabId));
  const ext = doc.type === "PDF" ? "PDF" : doc.type === "Word" ? "DOCX" : "TXT";
  const meta = [doc.pages ? `${doc.pages} page${doc.pages === 1 ? "" : "s"}` : "", `${doc.words.toLocaleString()} words`].filter(Boolean).join(" · ");

  const paper = h("article", { class: "paper" }, ...doc.blocks.map((b) => h(b.kind === "h" ? "h2" : "p", {}, b.text)));
  paper.setAttribute("data-cm-column", ""); // the "Explain simply" buttons line up outside this card
  app.replaceChildren(
    h("header", { class: "top" }, brand()),
    h(
      "main",
      { class: "reader" },
      h("section", { class: "doc-head" }, h("span", { class: `ftype ftype-${ext.toLowerCase()}` }, ext), h("div", { class: "doc-id" }, h("p", { class: "doc-name" }, doc.name), h("p", { class: "doc-meta" }, meta)), h("div", { class: "doc-actions" }, again, results)),
      readCheck(doc),
      paper
    )
  );
}

// "Did CheckMate really read and check everything?" One line for reading the file, one for the check.
function readCheck(doc: DocText) {
  const empty = doc.emptyPages ?? [];
  const read =
    doc.pages && empty.length
      ? h("p", { class: "rc warn" }, icon("alert"), h("span", {}, `Read ${doc.pages - empty.length} of ${doc.pages} pages. ${pageList(empty)} had no readable text (blank, or a scanned picture), so ${empty.length === 1 ? "it wasn’t" : "they weren’t"} checked.`))
      : h("p", { class: "rc ok" }, icon("check"), doc.pages ? `Fully read: all ${doc.pages} page${doc.pages === 1 ? "" : "s"}` : `Fully read: all ${doc.words.toLocaleString()} words`);
  const checked = h("p", { class: "rc wait" }, h("span", { class: "rc-dot" }), "Checking…");
  const box = h("section", { class: "readcheck" }, read, checked);

  stopWatching();
  if (tabId === undefined) return box;
  const key = stateKey(tabId);
  const show = (s: ScanState | undefined) => {
    if (!s || s.status === "scanning") return;
    if (s.status === "error") return void checked.replaceChildren(h("span", { class: "rc-dot" }), "Not checked (see the panel)");
    const done = s.result.words;
    const all = done >= doc.words * 0.98; // the server tidies spacing, so counts can differ by a hair
    checked.className = `rc ${all ? "ok" : "warn"}`;
    checked.replaceChildren(icon(all ? "check" : "alert"), all ? `Fully checked: all ${doc.words.toLocaleString()} words` : `Checked ${done.toLocaleString()} of ${doc.words.toLocaleString()} words`);
  };
  const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "session" && key in changes) show(changes[key]!.newValue as ScanState | undefined);
  };
  chrome.storage.onChanged.addListener(onChange);
  stopWatching = () => chrome.storage.onChanged.removeListener(onChange);
  return box;
}

async function scan(doc: DocText) {
  if (tabId === undefined) return;
  await clearScanState(tabId);
  const msg: ScanRequest = { type: "scan", tabId, page: { url: location.href, title: doc.name, text: doc.text, upload: true } };
  const res = (await chrome.runtime.sendMessage(msg).catch(() => null)) as { ok?: boolean } | null;
  busy = false;
  if (!res?.ok) {
    showPick("CheckMate couldn't start the check. Close this tab, reload CheckMate in chrome://extensions, and try again.");
    return;
  }
  await panel().open(tabId);
}

// ---------- Start ----------
(async () => {
  tabId = (await chrome.tabs.getCurrent())?.id;
  if (tabId !== undefined) await clearScanState(tabId); // a reload loses the document, so forget its old results
  showPick();
  // Drag and drop anywhere on the page
  let depth = 0;
  const setOver = (on: boolean) => app.querySelector(".drop")?.classList.toggle("over", on);
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    setOver(true);
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) setOver(false);
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    setOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (app.querySelector(".reader")) showPick(); // dropping a new file while one is open
    handle(file);
  });
})();
