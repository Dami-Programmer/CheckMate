// The popup: everything the person sees when they click the CheckMate icon.
import { ApiError, getMe, type AnalyzeResult, type Me } from "./api.js";
import { VERSION } from "./config.js";
import { PageError, readCurrentPage } from "./page.js";
import { getScanState, stateKey, type ScanRequest, type ScanState } from "./scan-state.js";
import { forget, getSaved, normalizeCode, save, type Saved } from "./storage.js";

const app = document.getElementById("app")!;
document.getElementById("version")!.textContent = `v${VERSION}`;

// Tiny helper for building elements. Text always goes in as text (never HTML).
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  el.append(...children);
  return el;
}

const show = (...nodes: Node[]) => app.replaceChildren(...nodes);

// ---------- Welcome screen: enter the invite code ----------
function showWelcome(notice?: string) {
  const input = h("input", {
    id: "code",
    type: "text",
    placeholder: "CM-XXXX-XXXX",
    autocomplete: "off",
    spellcheck: false,
    required: true,
    ariaLabel: "Invite code",
  });
  const button = h("button", { type: "submit", class: "primary" }, "Continue");
  const error = h("p", { class: "error", role: "alert" });
  if (notice) error.textContent = notice;

  const form = h("form", {}, h("label", { htmlFor: "code" }, "Invite code"), input, button, error);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = normalizeCode(input.value);
    if (!code) return;
    button.disabled = true;
    button.textContent = "Checking…";
    error.textContent = "";
    try {
      const me = await getMe(code);
      await save({ inviteCode: code, name: me.name });
      showHome({ inviteCode: code, name: me.name }, me);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : String(err);
      button.disabled = false;
      button.textContent = "Continue";
      input.focus();
    }
  });

  show(
    h("h2", {}, "Welcome to CheckMate"),
    h("p", {}, "CheckMate reads terms of service and privacy policies and flags the risky parts in plain words."),
    h("p", { class: "muted" }, "Enter the invite code you were given. You only need to do this once."),
    form
  );
  input.focus();
}

// ---------- Talking to the background worker ----------
const RELOAD_MESSAGE =
  "CheckMate needs a reload to finish updating. Go to chrome://extensions, click ↻ on the CheckMate card, then try again.";

// Sends a message to the background worker; resolves to null if it doesn't answer in time.
function sendWithTimeout(msg: unknown, ms: number): Promise<{ ok: boolean } | null> {
  return Promise.race([
    chrome.runtime.sendMessage(msg).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// True when Chrome is still running an older copy of CheckMate than this popup
// (the files were updated but the extension wasn't reloaded).
const needsReload = () => chrome.runtime.getManifest().version !== VERSION;

// ---------- Home screen: scan + result ----------
let stopListening: (() => void) | null = null;

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function scoreClass(score: number) {
  return score >= 8 ? "good" : score >= 5 ? "mid" : "bad";
}

function resultView(result: AnalyzeResult) {
  const n = result.flags.length;
  return h(
    "div",
    { class: `score-card ${scoreClass(result.score)}` },
    h("div", { class: "score" }, h("span", { class: "num" }, String(result.score)), h("span", { class: "of" }, "/10")),
    h(
      "div",
      {},
      h("div", { class: "label" }, result.label),
      h("div", { class: "muted small" }, n === 0 ? "No risky clauses found." : `${n} thing${n === 1 ? "" : "s"} to know about these terms.`),
      result.cached ? h("div", { class: "muted small" }, "Already scanned by someone: instant and free.") : ""
    )
  );
}

function scanningView(state: ScanState) {
  const seconds = h("span", {}, "");
  const tick = () => (seconds.textContent = `${Math.max(0, Math.round((Date.now() - state.startedAt) / 1000))}s`);
  tick();
  const timer = setInterval(tick, 1000);
  const view = h(
    "div",
    { class: "scanning" },
    h("div", { class: "spinner", ariaHidden: "true" }),
    h(
      "div",
      {},
      h("p", {}, "Scanning… ", seconds),
      h("p", { class: "muted small" }, "New pages can take up to 30 seconds. You can close this popup; the result will be here when you come back.")
    )
  );
  (view as any).cleanup = () => clearInterval(timer);
  return view;
}

function showHome(saved: Saved, me?: Me) {
  stopListening?.();
  stopListening = null;

  const scansLine = h(
    "p",
    { class: "muted small", id: "scans-left" },
    me ? `${me.scansLeftToday} of ${me.dailyLimit} new scans left today.` : "Checking your scans for today…"
  );
  const refreshScans = async () => {
    try {
      const m = await getMe(saved.inviteCode);
      scansLine.textContent = `${m.scansLeftToday} of ${m.dailyLimit} new scans left today.`;
    } catch {
      /* keep the old line */
    }
  };

  const scan = h("button", { type: "button", class: "primary", id: "scan" }, "Scan this page");
  const status = h("div", { id: "status", ariaLive: "polite" });

  let lastView: any = null;
  const setStatus = (...nodes: Node[]) => {
    lastView?.cleanup?.();
    lastView = nodes[0] ?? null;
    status.replaceChildren(...nodes);
  };

  // Show whatever the background worker has saved for this tab.
  const render = (state: ScanState | null) => {
    if (!state) {
      scan.disabled = false;
      scan.textContent = "Scan this page";
      return setStatus();
    }
    if (state.status === "scanning") {
      scan.disabled = true;
      scan.textContent = "Scanning…";
      return setStatus(scanningView(state));
    }
    scan.disabled = false;
    if (state.status === "done") {
      scan.textContent = "Scan again";
      return setStatus(
        resultView(state.result),
        h("p", { class: "muted small" }, "(The full list of flags arrives in the next step.)")
      );
    }
    scan.textContent = "Try again";
    if (state.error.code === "invalid_code") {
      forget().then(() => showWelcome("Your invite code no longer works. Please enter a new one."));
      return;
    }
    setStatus(h("p", { class: "error", role: "alert" }, state.error.message));
  };

  scan.addEventListener("click", async () => {
    scan.disabled = true;
    scan.textContent = "Reading the page…";
    setStatus();
    try {
      const page = await readCurrentPage();
      const msg: ScanRequest = { type: "scan", tabId: page.tabId, page: { url: page.url, title: page.title, text: page.text } };
      // The background worker answers "started" at once, then saves progress,
      // which we follow below. No answer means the worker isn't running our code.
      const ack = await sendWithTimeout(msg, 5000);
      if (!ack?.ok) {
        scan.disabled = false;
        scan.textContent = "Scan this page";
        setStatus(h("p", { class: "error", role: "alert" }, RELOAD_MESSAGE));
      }
    } catch (err) {
      scan.disabled = false;
      scan.textContent = "Scan this page";
      setStatus(h("p", { class: "error", role: "alert" }, err instanceof PageError ? err.message : String(err)));
    }
  });

  const change = h("button", { type: "button", class: "link" }, "Use a different code");
  change.addEventListener("click", async () => {
    await forget();
    showWelcome();
  });

  show(
    h("h2", {}, saved.name ? `Hi, ${saved.name}.` : "Hi there."),
    scan,
    status,
    scansLine,
    h("p", { class: "muted small" }, "Pages someone already scanned are free and don't count."),
    change
  );

  // Follow this tab's scan state (also picks up a scan that was running before the popup opened).
  currentTab().then(async (tab) => {
    if (tab?.id === undefined) return;
    const key = stateKey(tab.id);
    const matchesPage = (s: ScanState | null) => s && (!tab.url || s.url === tab.url) ? s : null;
    render(matchesPage(await getScanState(tab.id)));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "session" || !(key in changes)) return;
      const next = (changes[key]!.newValue as ScanState | undefined) ?? null;
      render(next);
      if (next?.status === "done" && !next.result.cached) refreshScans();
    };
    chrome.storage.onChanged.addListener(onChange);
    stopListening = () => chrome.storage.onChanged.removeListener(onChange);
  });
}

// ---------- Start ----------
async function start() {
  if (needsReload()) {
    return show(h("h2", {}, "Almost there"), h("p", { class: "error", role: "alert" }, RELOAD_MESSAGE));
  }
  const saved = await getSaved();
  if (!saved) return showWelcome();

  showHome(saved); // show straight away, then refresh from the server
  try {
    const me = await getMe(saved.inviteCode);
    if (me.name !== saved.name) await save({ ...saved, name: me.name });
    const line = document.getElementById("scans-left");
    if (line) line.textContent = `${me.scansLeftToday} of ${me.dailyLimit} new scans left today.`;
    const greeting = app.querySelector("h2");
    if (greeting) greeting.textContent = `Hi, ${me.name}.`;
  } catch (err) {
    if (err instanceof ApiError && err.code === "invalid_code") {
      await forget();
      showWelcome("Your invite code no longer works. Please enter a new one.");
    } else {
      const line = document.getElementById("scans-left");
      if (line) line.textContent = err instanceof ApiError ? err.message : String(err);
    }
  }
}

start();
