// The floating CheckMate agent. Injected into the page (activeTab) when the
// person presses "Scan this page" or "Show results" in the popup.
//
// A pill (animated orb + status + dots) with a card under it. The card has a
// header, a scrolling list of steps (ticked off with a green ✓ as they finish,
// then the results dropping in one after another), and an outcome box pinned
// at the bottom. Steps 1-2 are real; the middle steps run on a timer while the
// server works, and everything snaps to done the moment the real result arrives.
import type { AnalyzeResult } from "./api.js";
import { highlightOnPage, type HighlightItem } from "./highlight.js";
import { createMascot, type MascotMode } from "./mascot.js";
import { removeMarkers, setPanelBox, showMarkers, type MarkerItem } from "./markers.js";
import mascotCss from "./mascot.css";
import css from "./panel.css";
import { stateKey, type ScanState } from "./scan-state.js";
import { applyCss, COLOR_WORDS, groupFlags, h, scoreCard, type FlagGroup } from "./ui.js";

const HOST_ID = "checkmate-panel-host";
// Everything CheckMate puts on a page. Swept away on close and before opening, so a panel left behind
// by an older copy of the extension (or by a quick double open) can never get stuck on the page.
const PAGE_LAYERS = [HOST_ID, "checkmate-markers-host", "checkmate-explain-host"];
function removeStalePanels() {
  for (const id of PAGE_LAYERS) document.querySelectorAll(`#${id}`).forEach((el) => el.remove());
}
const WIDTH = 372;
const MARGIN = 12;
const LEGAL = "This explains the terms; it is not legal advice.";
const RESULT_GAP = 2000; // ms between one result appearing and the next

interface Pos {
  x: number;
  y: number;
}

// ---------- Steps ----------
interface StepDef {
  pill: string; // word shown in the pill while this step runs
  text: (s: { title: string; words?: number }) => (Node | string)[];
}
const STEPS: StepDef[] = [
  { pill: "Starting", text: () => ["Starting the check…"] },
  {
    pill: "Reading",
    text: ({ title, words }) => [
      "Reading page",
      h("span", { class: "quote-title" }, "“", h("span", { class: "favi" }, (title.trim()[0] ?? "C").toUpperCase()), h("span", { class: "t" }, title || "this page"), "”"),
      words ? h("span", { class: "meta" }, `${words.toLocaleString()} words`) : "",
    ],
  },
  { pill: "Sending", text: () => ["Sending it to CheckMate…"] },
  { pill: "Checking", text: () => ["Checking for 12 kinds of risky clauses…"] },
  { pill: "Verifying", text: () => ["Double-checking every quote against the page…"] },
  { pill: "Scoring", text: () => ["Scoring the terms…"] },
];
const OPEN_AT = [0, 450, 1200, 2100]; // ms after the scan started; steps 4-5 wait for the result
const WAIT_STEP = 3; // the step that stays active while the server works

let current: { host: HTMLElement; tabId: number; cleanup: () => void } | null = null;

// ---------- Small helpers ----------
const svg = (tag: string, attrs: Record<string, string>) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
function checkSvg() {
  const s = svg("svg", { viewBox: "0 0 24 24", fill: "none", class: "ic", "aria-hidden": "true" });
  s.append(svg("path", { d: "M5 13l4 4L19 7", stroke: "white", "stroke-width": "3.2", "stroke-linecap": "round", "stroke-linejoin": "round" }));
  return s;
}
// A small outlined checklist icon for the outcome box.
function noteIcon() {
  const s = svg("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: "concluded-ic",
    "aria-hidden": "true",
  });
  s.append(svg("rect", { x: "4", y: "3", width: "16", height: "18", rx: "3" }), svg("path", { d: "M8.5 12.5l2.5 2.5 4.5-5" }));
  return s;
}

// The pinned outcome box: a tag, one line of text, and the "not legal advice" notice.
function outcomeBox(tag: string, body: string, tone: "" | "error" = "", action?: HTMLElement) {
  return h(
    "div",
    { class: `concluded drop${tone ? " tone-error" : ""}`, style: "--i:0" },
    h("div", { class: "concluded-head" }, noteIcon(), h("span", { class: "concluded-tag" }, tag), ...(action ? [action] : [])),
    h("p", {}, body),
    h("p", { class: "legal" }, LEGAL)
  );
}

function flagCard(g: FlagGroup, first: number, items: HighlightItem[], i: number) {
  const n = g.quotes.length;
  let next = 0;
  const label = () => (n === 1 ? "Show on page" : `Show on page (${next + 1} of ${n})`);
  const button = h("button", { type: "button", class: "show-on-page" }, label());
  const note = h("div", { class: "flag-note", ariaLive: "polite" });
  button.addEventListener("click", () => {
    const at = next;
    next = (next + 1) % n;
    button.textContent = label();
    const r = highlightOnPage(items, first + at);
    if (r.focus === "shown") return void note.replaceChildren();
    note.replaceChildren(
      h(
        "p",
        { class: "muted small" },
        r.focus === "hidden"
          ? "This part is hidden on the page (maybe inside a closed section). Here are the exact words:"
          : "Couldn't find this on the page (it may have changed since the scan). Here are the exact words:"
      ),
      h("blockquote", {}, `“${g.quotes[at]}”`)
    );
  });
  return h(
    "li",
    { class: `flag ${g.color} drop`, style: `--i:${i}` },
    h("div", { class: "flag-head" }, h("span", { class: "dot", ariaHidden: "true" }), h("span", { class: "flag-name" }, g.name)),
    h("span", { class: "sr-only" }, `${COLOR_WORDS[g.color]}. `),
    h("p", { class: "flag-why" }, g.explanation),
    button,
    note
  );
}

// The results: the score, then each heading and flag card dropping in one after another.
// Also highlights the clauses on the page and puts the "Explain simply" buttons beside them.
function buildResults(result: AnalyzeResult) {
  const groups = groupFlags(result.flags);
  const items: HighlightItem[] = [];
  const firstIndex = new Map<number, number>();
  for (const g of groups) {
    firstIndex.set(g.type, items.length);
    for (const quote of g.quotes) items.push({ quote, color: g.color });
  }
  if (items.length) highlightOnPage(items, null); // soft highlights on the page
  const markers: MarkerItem[] = groups.flatMap((g) => g.quotes.map((quote) => ({ quote, color: g.color, type: g.type, name: g.name })));
  showMarkers(markers);

  const risky = groups.filter((g) => g.color !== "green").length;
  const hide = <T extends HTMLElement>(el: T): T => {
    el.hidden = true;
    return el;
  };
  const nodes: Node[] = [];
  const units: HTMLElement[][] = []; // what appears together: [hint + score], then [heading + first card], [next card]...
  const first: HTMLElement[] = [];
  if (groups.length) {
    const hint = hide(h("p", { class: "hint drop" }, "They're highlighted on the page. Tap the 💡 Explain simply button next to any of them for an easy explanation."));
    nodes.push(hint);
    first.push(hint);
  }
  const card = hide(scoreCard(result, "drop"));
  nodes.push(card);
  first.push(card);
  units.push(first);
  for (const color of ["red", "orange", "green"] as const) {
    const list = groups.filter((g) => g.color === color);
    if (!list.length) continue;
    const heading = hide(h("h3", { class: `${color} drop` }, COLOR_WORDS[color]));
    const cards = list.map((g) => hide(flagCard(g, firstIndex.get(g.type)!, items, 0)));
    nodes.push(heading, h("ul", {}, ...cards));
    cards.forEach((c, j) => units.push(j === 0 ? [heading, c] : [c]));
  }
  return { nodes, units, risky };
}

// ---------- The panel ----------
async function open(tabId: number) {
  if (current?.host.isConnected && current.tabId === tabId) return; // already open
  close();

  const host = h("div", { id: HOST_ID });
  const shadow = host.attachShadow({ mode: "closed" });
  // Pill
  const aura = h("div", { class: "aura" });
  const mascot = createMascot(); // the illustration: it reads while a scan runs
  const pillLabel = h("span", { class: "pill-label muted" }, "Starting");
  const dots = h("span", { class: "dots", ariaHidden: "true" }, h("span", { class: "dot-b" }, "."), h("span", { class: "dot-b" }, "."), h("span", { class: "dot-b" }, "."));
  const closeBtn = h("button", { type: "button", class: "pill-btn", title: "Close CheckMate" }, h("span", { class: "glyph" }), "Close");
  const pill = h(
    "div",
    { class: "pill", title: "Drag to move · click to show or hide the details" },
    mascot.el,
    h("div", { class: "pill-text", ariaLive: "polite" }, pillLabel, dots),
    closeBtn
  );

  // Card: header, scrolling steps + results, pinned outcome box
  const live = h("span", { class: "live tone-running" }, h("span", { class: "live-ping" }), h("span", { class: "live-core" }));
  const chip = h("span", { class: "chip" }, document.title || location.hostname);
  const status = h("span", { class: "status tone-running" }, "Starting");
  const head = h("div", { class: "card-head" }, h("div", { class: "head-left" }, live, h("p", { class: "head-title" }, "Terms Check"), chip), status);
  const stepsList = h("ol", { class: "steps" });
  const results = h("div", { class: "results", hidden: true });
  const scroll = h("div", { class: "scroll" }, stepsList, results);
  const outcome = h("div", { class: "outcome", hidden: true });
  const card = h("div", { class: "card" }, head, scroll, outcome);
  const feed = h("div", { class: "feed" }, h("div", { class: "card-clip" }, card));

  const root = h("div", { class: "cm", role: "dialog", ariaLabel: "CheckMate" }, h("div", { class: "pill-wrap" }, aura, pill), feed);
  applyCss(shadow, css);
  applyCss(shadow, mascotCss);
  shadow.append(root);
  document.documentElement.appendChild(host);
  // Register right away, so a Close click or a second open() during start-up still finds this panel.
  const cleanups: (() => void)[] = [];
  let closed = false;
  current = {
    host,
    tabId,
    cleanup: () => {
      closed = true;
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch {
          /* e.g. the extension was reloaded: its calls throw, but we still finish closing */
        }
      }
    },
  };
  // Close always removes THIS panel, even if it is not the current one (a leftover) or cleanup fails.
  // Attached right away, so it works even in the first instant while the panel is still starting up.
  closeBtn.addEventListener("click", () => {
    if (current?.host === host) close();
    else host.remove();
  });
  // Test harness only: lets automated tests look inside the closed panel.
  // In Chrome this runs in CheckMate's isolated world, so web pages can't set it.
  (globalThis as any).__checkmateTestHook?.(shadow);
  requestAnimationFrame(() => feed.classList.add("open"));

  // ----- Position + dragging (by the pill or the card header) -----
  const saved = (await chrome.storage.local.get("panelPos")).panelPos as Pos | undefined;
  if (closed) return; // closed while starting up
  const clamp = (p: Pos): Pos => ({
    x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, window.innerWidth - Math.min(WIDTH, root.offsetWidth || WIDTH) - MARGIN)),
    y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, window.innerHeight - (pill.offsetHeight || 54) - MARGIN)),
  });
  let pos = clamp(saved ?? { x: window.innerWidth - WIDTH - 20, y: 20 });
  const place = () => {
    root.style.left = `${pos.x}px`;
    root.style.top = `${pos.y}px`;
    // Keep the whole card on screen: the steps/results scroll inside if space is short.
    // (The header and the pinned outcome box always stay visible.)
    const outcomeH = outcome.hidden ? 0 : outcome.offsetHeight + 12;
    const room = window.innerHeight - pos.y - MARGIN - pill.offsetHeight - 12 - 6 - head.offsetHeight - outcomeH - 4;
    scroll.style.maxHeight = `${Math.max(120, Math.min(420, room))}px`;
    // Tell the "Explain simply" buttons where the panel is, so they keep to the other side.
    setPanelBox(root.getBoundingClientRect());
  };
  place();
  // Re-measure whenever the header or the outcome box changes size (e.g. when it appears).
  const ro = new ResizeObserver(() => place());
  ro.observe(head);
  ro.observe(outcome);
  ro.observe(pill);
  cleanups.push(() => ro.disconnect());

  let drag: { px: number; py: number; x: number; y: number; moved: boolean; fromPill: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    drag = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, moved: false, fromPill: el === pill };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    root.classList.add("dragging");
    pos = clamp({ x: drag.x + dx, y: drag.y + dy });
    place();
  };
  const onUp = () => {
    if (!drag) return;
    const wasClick = !drag.moved && drag.fromPill;
    drag = null;
    root.classList.remove("dragging");
    if (wasClick) feed.classList.toggle("open"); // click the pill to show/hide the details
    else chrome.storage.local.set({ panelPos: pos });
    setPanelBox(root.getBoundingClientRect());
  };
  for (const el of [pill, head]) {
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }
  const onResize = () => {
    pos = clamp(pos);
    place();
  };
  window.addEventListener("resize", onResize);
  cleanups.push(() => window.removeEventListener("resize", onResize));

  // ----- The step feed -----
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const clearTimers = () => timers.splice(0).forEach((t) => clearTimeout(t));
  cleanups.push(clearTimers);
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let follow = true; // keep the newest result in view, until the person scrolls on their own
  scroll.addEventListener("wheel", () => (follow = false), { passive: true });
  scroll.addEventListener("pointerdown", () => (follow = false));

  const stepEls = STEPS.map(() => {
    const done = h("span", { class: "node-done", hidden: true }, checkSvg());
    const active = h("span", { class: "node-active", hidden: true });
    const err = h("span", { class: "node-error", hidden: true }, "!");
    const text = h("span", { class: "step-text" });
    const li = h("li", { class: "step", hidden: true }, h("span", { class: "node" }, done, active, err), text);
    stepsList.append(li);
    return { li, done, active, err, text, state: "hidden" as "hidden" | "active" | "done" | "error" };
  });
  let info = { title: document.title, words: undefined as number | undefined };

  const setPill = (label: string, mode: MascotMode) => {
    pillLabel.textContent = label;
    pillLabel.classList.toggle("muted", mode === "running");
    dots.hidden = mode !== "running";
    mascot.setMode(mode);
    aura.classList.toggle("visible", mode === "running");
    // The header's status chip shows only while working (or if it stopped).
    status.hidden = mode === "done" || mode === "idle";
    status.textContent = mode === "running" ? label : "Stopped";
    const tone = mode === "idle" ? "done" : mode;
    status.className = `status tone-${tone}`;
    live.className = `live tone-${tone}${mode === "running" ? "" : " still"}`;
  };
  const activate = (i: number) => {
    const s = stepEls[i]!;
    if (s.state !== "hidden") return;
    s.text.replaceChildren(...STEPS[i]!.text(info));
    s.li.hidden = false;
    s.active.hidden = false;
    s.text.className = "step-text active";
    s.state = "active";
    setPill(STEPS[i]!.pill, "running");
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" }); // follow the newest step
  };
  const complete = (i: number) => {
    const s = stepEls[i]!;
    if (s.state === "hidden") activate(i);
    if (s.state === "done") return;
    s.active.hidden = true;
    s.done.hidden = false;
    s.done.classList.remove("pop");
    void s.done.offsetWidth; // restart the pop animation
    s.done.classList.add("pop");
    s.text.className = "step-text done";
    s.state = "done";
  };
  const resetSteps = () => {
    clearTimers();
    removeMarkers();
    for (const s of stepEls) {
      s.li.hidden = true;
      s.done.hidden = s.active.hidden = s.err.hidden = true;
      s.state = "hidden";
    }
    results.hidden = true;
    results.replaceChildren();
    outcome.hidden = true;
    outcome.replaceChildren();
    scroll.scrollTop = 0;
    follow = true;
  };

  // Scanning: open steps 0-3 on their timetable (based on when the scan really started).
  const showScanning = (state: ScanState) => {
    const elapsed = Date.now() - state.startedAt;
    for (let i = 0; i <= WAIT_STEP; i++) {
      const go = () => {
        if (i > 0) complete(i - 1);
        activate(i);
      };
      if (OPEN_AT[i]! <= elapsed) go();
      else later(OPEN_AT[i]! - elapsed, go);
    }
  };

  // Done: tick off whatever is left (quickly), then reveal the outcome box and the results.
  const showDone = (result: AnalyzeResult, sawScanning: boolean) => {
    clearTimers();
    const gap = sawScanning ? 380 : 170;
    let t = 0;
    for (let i = 0; i < STEPS.length; i++) {
      if (stepEls[i]!.state === "done") continue;
      later(t, () => {
        if (i > 0) complete(i - 1);
        activate(i);
      });
      t += gap;
    }
    later(t, () => complete(STEPS.length - 1));
    later(t + 250, () => {
      const { nodes, units, risky } = buildResults(result);
      results.replaceChildren(...nodes);
      results.hidden = false;
      const smooth = (): ScrollBehavior => (reduceMotion() ? "auto" : "smooth");
      const finish = () => {
        setPill("Done", "done");
        outcome.replaceChildren(
          outcomeBox("Checked", risky === 0 ? "✅ Done. Nothing risky stood out in these terms." : `✅ Done. Found ${risky} thing${risky === 1 ? "" : "s"} worth your attention.`)
        );
        outcome.hidden = false;
        place(); // the pinned box changed: re-measure so the card stays on screen
      };
      let next = 0;
      const showNext = () => {
        const unit = units[next++]!;
        unit.forEach((el, j) => {
          el.style.cssText = `--i:${j}`;
          el.hidden = false;
        });
        requestAnimationFrame(() => {
          if (next === 1) scroll.scrollTo({ top: Math.max(0, results.offsetTop - 6), behavior: smooth() });
          else if (follow) scroll.scrollTo({ top: scroll.scrollHeight, behavior: smooth() });
        });
      };
      const showAll = () => {
        clearTimers();
        while (next < units.length) showNext();
        finish();
        requestAnimationFrame(() => scroll.scrollTo({ top: Math.max(0, results.offsetTop - 6), behavior: "auto" }));
      };
      // Re-opened later (already seen), or only one result: no need to wait.
      if (!sawScanning || units.length === 1) return showAll();

      // Live scan: one result every RESULT_GAP, the reader keeps reading until the last one lands.
      setPill("Results", "running");
      const skip = h("button", { type: "button", class: "skip" }, "Show all now");
      skip.addEventListener("click", showAll);
      outcome.replaceChildren(outcomeBox("Showing results", "One at a time, so you can read each one.", "", skip));
      outcome.hidden = false;
      place();
      showNext();
      for (let k = 1; k < units.length; k++) later(k * RESULT_GAP, showNext);
      later((units.length - 1) * RESULT_GAP + 900, finish);
    });
  };

  const showError = (message: string) => {
    clearTimers();
    let at = stepEls.findIndex((s) => s.state === "active");
    if (at < 0) at = Math.max(0, stepEls.findLastIndex((s) => s.state === "done"));
    const s = stepEls[at]!;
    if (s.state === "hidden") activate(at);
    s.active.hidden = true;
    s.err.hidden = false;
    s.err.classList.add("pop");
    s.state = "error";
    setPill("Stopped", "error");
    results.hidden = true;
    results.replaceChildren();
    outcome.replaceChildren(outcomeBox("Couldn't finish", message, "error"));
    outcome.hidden = false;
    place();
  };

  // ----- Follow the scan state saved by the background worker -----
  let phase: "none" | "scanning" | "done" | "error" = "none";
  let shownKey = "";
  const render = (state: ScanState | null) => {
    if (state && state.url !== location.href) state = null; // a scan of a different page
    const key = state ? `${state.startedAt}:${state.status}` : "none";
    if (key === shownKey) return;
    shownKey = key;
    if (state) info = { title: state.title || document.title, words: state.words };
    chip.textContent = info.title || location.hostname;

    if (!state) {
      resetSteps();
      setPill("Ready", "idle");
      outcome.replaceChildren(outcomeBox("Ready", "No results for this page yet. Click the CheckMate icon and press “Scan this page”."));
      outcome.hidden = false;
      phase = "none";
    } else if (state.status === "scanning") {
      if (phase !== "scanning") resetSteps();
      phase = "scanning";
      showScanning(state);
    } else if (state.status === "done") {
      const saw = phase === "scanning";
      if (!saw) resetSteps();
      phase = "done";
      showDone(state.result, saw);
    } else {
      if (phase !== "scanning") resetSteps();
      phase = "error";
      showError(
        state.error.code === "invalid_code"
          ? "Your invite code no longer works. Click the CheckMate icon to enter a new one."
          : state.error.message
      );
    }
    place();
  };

  const key = stateKey(tabId);
  const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "session" && key in changes) render((changes[key]!.newValue as ScanState | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(onChange);
  cleanups.push(() => chrome.storage.onChanged.removeListener(onChange));
  const first = await chrome.storage.session.get(key);
  if (closed) return; // closed while starting up
  render((first[key] as ScanState | undefined) ?? null);
}

// Closing CheckMate cleans the page: panel, "Explain simply" buttons and highlights.
// The panel is removed first and every other step may fail (for example after the extension
// was reloaded), so Close can never leave the panel stuck on screen.
function close() {
  const c = current;
  current = null;
  try {
    c?.cleanup();
  } catch {
    /* keep closing */
  }
  c?.host.remove();
  removeStalePanels();
  try {
    removeMarkers();
    const registry = (CSS as any).highlights;
    for (const name of ["checkmate-red", "checkmate-orange", "checkmate-green", "checkmate-focus"]) registry?.delete(name);
  } catch {
    /* nothing left to clean */
  }
}

// The popup calls these through chrome.scripting.executeScript.
const g = globalThis as any;
if (!g.__checkmatePanel) g.__checkmatePanel = { open, close, isOpen: () => !!current?.host.isConnected };
