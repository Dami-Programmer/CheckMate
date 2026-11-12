// The popup: sign in, scan the current page, or bring back the floating results panel.
// Results themselves appear in the floating panel on the page (panel.ts).
import { ApiError, getMe, type AnalyzeResult, type Me } from "./api.js";
import { VERSION } from "./config.js";
import { createMascot } from "./mascot.js";
import mascotCss from "./mascot.css";
import { PageError, readCurrentPage } from "./page.js";
import { getScanState, stateKey, type ScanRequest, type ScanState } from "./scan-state.js";
import { forget, getSaved, normalizeCode, save, type Saved } from "./storage.js";
import { applyCss, groupFlags, h, scoreClass } from "./ui.js";

applyCss(document, mascotCss);
const app = document.getElementById("app")!;
let screen = 0; // bumped whenever a new screen is shown, so late answers for an old screen are ignored

// ---------- Icons (inline SVG) ----------
const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
} as const;
type IconName = keyof typeof ICONS;
function icon(name: IconName): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name]; // our own constants, never page or server text
  return svg;
}

// ---------- Small building blocks ----------
type Kind = "primary" | "secondary";
function button(label: string, kind: Kind, opts: { icon?: IconName; wide?: boolean; onClick?: () => void } = {}) {
  const b = h("button", { type: "button", class: `btn btn-${kind}${opts.wide ? " btn-wide" : ""}` }, ...(opts.icon ? [icon(opts.icon)] : []), label);
  if (opts.onClick) b.addEventListener("click", opts.onClick);
  return b;
}

// The frame around every screen: header, content, footer.
function shell(header: Node, ...content: Node[]) {
  return [
    header,
    h("main", { class: "main" }, ...content),
    h("footer", { class: "foot" }, h("span", {}, "This explains the terms; it is not legal advice."), h("span", { class: "ver" }, `v${VERSION}`)),
  ];
}
function brand() {
  return h(
    "div",
    { class: "brand" },
    h("span", { class: "logo" }, icon("check")),
    h("span", { class: "wordmark" }, "Check", h("span", {}, "Mate"))
  );
}
const show = (...nodes: Node[]) => app.replaceChildren(...nodes);
const bareHeader = () => h("header", { class: "top" }, brand());

// ---------- Welcome screen: enter the invite code ----------
function showWelcome(notice?: string) {
  screen++;
  const mascot = createMascot();
  const input = h("input", {
    id: "code",
    type: "text",
    placeholder: "CM-XXXX-XXXX",
    autocomplete: "off",
    spellcheck: false,
    required: true,
    ariaLabel: "Invite code",
  });
  const button_ = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Continue");
  const error = h("p", { class: "form-error", role: "alert" });
  const setError = (msg: string) => {
    error.replaceChildren(...(msg ? [icon("alert"), msg] : []));
  };
  setError(notice ?? "");

  const form = h(
    "form",
    { class: "form" },
    h("div", { class: "field" }, h("label", { class: "eyebrow", htmlFor: "code" }, "Invite code"), h("div", { class: "input-wrap" }, icon("key"), input)),
    error,
    button_
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = normalizeCode(input.value);
    if (!code) return;
    button_.disabled = true;
    button_.textContent = "Checking…";
    setError("");
    try {
      const me = await getMe(code);
      await save({ inviteCode: code, name: me.name });
      showHome({ inviteCode: code, name: me.name }, me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      button_.disabled = false;
      button_.textContent = "Continue";
      input.focus();
    }
  });

  show(
    ...shell(
      bareHeader(),
      h(
        "section",
        { class: "hero" },
        mascot.el,
        h("span", { class: "pill-chip" }, "Invite only"),
        h("h1", {}, "Know what you’re agreeing to."),
        h("p", {}, "CheckMate reads terms of service and privacy policies and flags the risky parts in plain words.")
      ),
      form,
      h("p", { class: "help" }, "No code yet? Ask the person who invited you.")
    )
  );
  input.focus();
}

// ---------- Talking to the background worker and the page ----------
const RELOAD_MESSAGE =
  "CheckMate needs a reload to finish updating. Go to chrome://extensions, click ↻ on the CheckMate card, then try again.";

// Sends a message to the background worker; resolves to null if it doesn't answer in time.
function sendWithTimeout(msg: unknown, ms: number): Promise<{ ok: boolean } | null> {
  return Promise.race([
    chrome.runtime.sendMessage(msg).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// True when Chrome is still running an older copy of CheckMate than this popup.
const needsReload = () => chrome.runtime.getManifest().version !== VERSION;

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Puts the floating panel on the page. Returns false if Chrome won't allow it.
async function openPanel(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["panel.js"] });
    await chrome.scripting.executeScript({ target: { tabId }, func: (id: number) => (globalThis as any).__checkmatePanel.open(id), args: [tabId] });
    return true;
  } catch {
    return false;
  }
}

// ---------- Home screen pieces ----------
const hostOf = (url?: string) => {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
// Chrome's own pages (settings, the Web Store…) can't be read by any extension.
const isScannable = (url?: string) => {
  if (!url) return true;
  if (/^(chrome|edge|about|brave|opera|vivaldi|devtools|view-source|chrome-extension|chrome-search):/i.test(url)) return false;
  try {
    const u = new URL(url);
    if (u.hostname === "chromewebstore.google.com" || (u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore"))) return false;
  } catch {
    /* not a URL: leave it to the normal error message */
  }
  return true;
};

function pageCard(tab: chrome.tabs.Tab | undefined, scannable: boolean, extra: Node[] = [], tone = "") {
  const host = hostOf(tab?.url);
  const title = tab?.title?.trim() || host || "This page";
  const fav = h("span", { class: "fav" }, (host || title)[0]?.toUpperCase() ?? "•");
  if (tab?.favIconUrl && scannable) {
    const img = h("img", { src: tab.favIconUrl, alt: "" });
    img.addEventListener("load", () => fav.replaceChildren(img));
  }
  return h(
    "section",
    { class: `card${tone ? ` tone-${tone}` : ""}` },
    h("div", { class: "eyebrow" }, h("span", { class: "dot" }), "This page"),
    h("div", { class: "page" }, fav, h("div", { style: "min-width:0" }, h("p", { class: "page-title" }, title), ...(host ? [h("p", { class: "page-host" }, host)] : []))),
    ...(scannable
      ? []
      : [h("div", { class: "page-note" }, icon("lock"), h("span", {}, "Chrome’s own pages can’t be read by extensions. Open a terms or privacy page to scan it."))]),
    ...extra
  );
}

function ring(score: number, tone: string) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 84 84");
  svg.setAttribute("aria-hidden", "true");
  const mk = (cls: string) => {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "42");
    c.setAttribute("cy", "42");
    c.setAttribute("r", String(R));
    return c;
  };
  const track = mk("track");
  const arc = mk("arc");
  arc.setAttribute("stroke-dasharray", String(C));
  arc.setAttribute("stroke-dashoffset", String(C)); // starts empty, then fills
  svg.append(track, arc);
  // fill the arc a moment after it appears (a timer, not an animation frame, so it also runs in a background tab)
  setTimeout(() => arc.setAttribute("stroke-dashoffset", String(C * (1 - Math.max(0, Math.min(10, score)) / 10))), 80);
  return h(
    "div",
    { class: `ring tone-${tone}`, role: "img", ariaLabel: `Score ${score} out of 10` },
    svg,
    h("div", { class: "ring-num" }, h("b", {}, String(score)), h("span", {}, "/10"))
  );
}

function resultBlock(result: AnalyzeResult, withNote = true): Node[] {
  const tone = scoreClass(result.score);
  const groups = groupFlags(result.flags);
  const n = (c: string) => groups.filter((g) => g.color === c).length;
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const chips = [
    n("red") ? h("span", { class: "count count-red" }, plural(n("red"), "thing to watch", "things to watch")) : null,
    n("orange") ? h("span", { class: "count count-orange" }, `${n("orange")} worth knowing`) : null,
    n("green") ? h("span", { class: "count count-green" }, plural(n("green"), "good sign", "good signs")) : null,
  ].filter((x): x is HTMLSpanElement => x !== null);
  return [
    h(
      "div",
      { class: "result" },
      ring(result.score, tone),
      h("div", {}, h("p", { class: "verdict" }, result.label), chips.length ? h("div", { class: "counts" }, ...chips) : h("p", { class: "nothing" }, "No risky clauses found."))
    ),
    ...(withNote ? [h("p", { class: "note" }, icon("bolt"), result.cached ? "Already scanned by someone: instant and free." : "Freshly scanned just now.")] : []),
  ];
}

function busyCard() {
  const mascot = createMascot();
  mascot.setMode("running");
  return h(
    "section",
    { class: "card busy", ariaLive: "polite" },
    mascot.el,
    h("p", { class: "busy-title" }, "Scanning this page…"),
    h("p", { class: "busy-sub" }, "Results will appear in the CheckMate panel on the page.")
  );
}

function meterCard(me: Me | undefined, error: string, lean = false) {
  const card = h("section", { class: "card" }, h("div", { class: "eyebrow" }, "Daily scans"));
  if (me) {
    const left = Math.max(0, me.scansLeftToday);
    const limit = Math.max(1, me.dailyLimit);
    card.append(h("div", { class: "meter-row", id: "scans-left" }, h("b", {}, String(left)), h("span", {}, `of ${limit} new scans left today`)));
    if (limit <= 30) {
      card.append(h("div", { class: "segs", role: "img", ariaLabel: `${left} of ${limit} scans left` }, ...Array.from({ length: limit }, (_, i) => h("i", { class: `seg${i < left ? " on" : ""}` }))));
    } else {
      const fill = h("i", {});
      fill.style.width = `${(left / limit) * 100}%`;
      card.append(h("div", { class: "bar", role: "img", ariaLabel: `${left} of ${limit} scans left` }, fill));
    }
    if (!lean) card.append(h("p", { class: "fine" }, "Pages already scanned by someone are free."));
  } else if (error) {
    card.append(h("p", { class: "fine bad", id: "scans-left" }, error));
  } else {
    card.append(h("div", { class: "skel", id: "scans-left" }), h("div", { class: "skel s" }));
  }
  return card;
}

// ---------- Home screen ----------
interface Home {
  setMe(me: Me): void;
  setMeError(message: string): void;
}

function showHome(saved: Saved, initialMe?: Me): Home {
  const id = ++screen;
  const alive = () => id === screen;
  let name = saved.name;
  let me = initialMe;
  let meError = "";
  let tab: chrome.tabs.Tab | undefined;
  let state: ScanState | null = null;
  let inlineError = "";
  let busy = false; // a scan is being started: the button stays locked through any redraw
  let menuOpen = false;

  const firstName = () => (name || "there").split(/\s+/)[0]!;

  const startScan = async (btn: HTMLButtonElement) => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.textContent = "Reading the page…";
    inlineError = "";
    try {
      const page = await readCurrentPage();
      const msg: ScanRequest = { type: "scan", tabId: page.tabId, page: { url: page.url, title: page.title, text: page.text } };
      const ack = await sendWithTimeout(msg, 5000);
      if (!ack?.ok) throw new Error(RELOAD_MESSAGE);
      if (!(await openPanel(page.tabId))) throw new Error("CheckMate couldn't open its panel on this page. Try reloading the page.");
      window.close(); // the floating panel takes over from here
      setTimeout(() => {
        busy = false; // only matters if the popup somehow stayed open
        draw();
      }, 1500);
    } catch (err) {
      busy = false;
      inlineError = err instanceof PageError || err instanceof Error ? err.message : String(err);
      draw();
    }
  };
  const showPanel = async () => {
    if (tab?.id !== undefined && (await openPanel(tab.id))) window.close();
    else {
      inlineError = "CheckMate couldn't open its panel on this page. Try reloading the page.";
      draw();
    }
  };
  const changeCode = async () => {
    await forget();
    showWelcome();
  };

  const header = () => {
    const chip = h("button", { type: "button", class: "acct", ariaHasPopup: "menu", ariaExpanded: String(menuOpen), ariaLabel: `Account: ${name}` }, h("span", { class: "avatar" }, (firstName()[0] ?? "?").toUpperCase()), firstName(), icon("chevron"));
    chip.addEventListener("click", () => {
      menuOpen = !menuOpen;
      draw();
      if (menuOpen) (app.querySelector(".menu-item") as HTMLElement | null)?.focus();
    });
    const top = h("header", { class: "top" }, brand(), chip);
    if (menuOpen) {
      const item = h("button", { type: "button", class: "menu-item", role: "menuitem" }, icon("logout"), "Use a different code");
      item.addEventListener("click", changeCode);
      top.append(
        h(
          "div",
          { class: "menu", role: "menu", ariaLabel: "Account" },
          h("div", { class: "menu-head" }, h("p", { class: "menu-name" }, name || "Signed in"), h("p", { class: "menu-sub" }, "Signed in with an invite code")),
          item
        )
      );
    }
    return top;
  };

  const actions = (scannable: boolean) => {
    const scan = () => {
      if (busy) {
        const locked = button("Reading the page…", state?.status === "done" ? "secondary" : "primary", { icon: "scan", wide: !state || state.status !== "done" });
        locked.disabled = true;
        return locked;
      }
      const b = button(state?.status === "error" ? "Try again" : state?.status === "done" ? "Scan again" : "Scan this page", state?.status === "done" ? "secondary" : "primary", { icon: state?.status === "done" ? "refresh" : "scan", wide: !state || state.status !== "done" });
      b.disabled = !scannable;
      b.addEventListener("click", () => startScan(b));
      return b;
    };
    if (state?.status === "scanning") return h("div", { class: "actions" }, button("Show the panel", "secondary", { icon: "panel", wide: true, onClick: showPanel }));
    if (state?.status === "done") return h("div", { class: "actions" }, button("Show results", "primary", { icon: "panel", onClick: showPanel }), scan());
    return h("div", { class: "actions" }, scan());
  };

  function draw() {
    if (!alive()) return;
    const scannable = isScannable(tab?.url);
    const lean = !!inlineError; // an error is showing: drop the optional extras so everything stays under 600px
    const content: Node[] = [];
    if (state?.status === "scanning") content.push(busyCard());
    else {
      if (state?.status === "done") content.push(pageCard(tab, scannable, resultBlock(state.result, !lean), scoreClass(state.result.score)));
      else content.push(pageCard(tab, scannable));
      if (state?.status === "error") content.push(h("div", { class: "problem", role: "alert" }, icon("alert"), h("p", {}, state.error.message)));
    }
    if (inlineError) content.push(h("div", { class: "problem", role: "alert" }, icon("alert"), h("p", {}, inlineError)));
    content.push(actions(scannable), meterCard(me, meError, lean));
    show(...shell(header(), ...content));
  }

  // Close the account menu with Esc or a click outside it.
  document.addEventListener("keydown", (e) => {
    if (alive() && menuOpen && e.key === "Escape") {
      menuOpen = false;
      draw();
      (app.querySelector(".acct") as HTMLElement | null)?.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (alive() && menuOpen && !(e.target as Element).closest(".menu, .acct")) {
      menuOpen = false;
      draw();
    }
  });

  draw();
  currentTab().then(async (t) => {
    if (!alive()) return;
    tab = t;
    if (t?.id !== undefined) {
      const s = await getScanState(t.id);
      if (!alive()) return;
      state = s && (!t.url || s.url === t.url) ? s : null;
      if (state?.status === "error" && state.error.code === "invalid_code") {
        forget().then(() => showWelcome("Your invite code no longer works. Please enter a new one."));
        return;
      }
      const key = stateKey(t.id);
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (!alive() || areaName !== "session" || !(key in changes)) return;
        const next = (changes[key]!.newValue as ScanState | undefined) ?? null;
        if (next?.status === "error" && next.error.code === "invalid_code") {
          forget().then(() => showWelcome("Your invite code no longer works. Please enter a new one."));
          return;
        }
        state = next;
        inlineError = "";
        draw();
      });
    }
    draw();
  });

  return {
    setMe(m) {
      if (!alive()) return;
      me = m;
      meError = "";
      if (m.name) name = m.name;
      draw();
    },
    setMeError(message) {
      if (!alive()) return;
      meError = message;
      draw();
    },
  };
}

// ---------- "Reload needed" screen ----------
function showReload() {
  screen++;
  show(
    ...shell(
      bareHeader(),
      h(
        "section",
        { class: "card" },
        h("div", { class: "eyebrow" }, "Almost there"),
        h("p", { class: "card-title" }, "CheckMate needs a quick reload"),
        h("p", { class: "card-sub", role: "alert" }, "Chrome is still running an older copy. Reloading takes a few seconds:"),
        h(
          "ol",
          { class: "steps" },
          h("li", {}, "Open ", h("code", {}, "chrome://extensions")),
          h("li", {}, "Click the ↻ on the CheckMate card"),
          h("li", {}, "Come back and click the CheckMate icon")
        )
      )
    )
  );
}

// ---------- Start ----------
async function start() {
  if (needsReload()) return showReload();
  const saved = await getSaved();
  if (!saved) return showWelcome();

  const home = showHome(saved); // show straight away with what we know, then refresh from the server
  try {
    const me = await getMe(saved.inviteCode);
    if (me.name !== saved.name) await save({ ...saved, name: me.name });
    home.setMe(me);
  } catch (err) {
    if (err instanceof ApiError && err.code === "invalid_code") {
      await forget();
      showWelcome("Your invite code no longer works. Please enter a new one.");
    } else {
      home.setMeError(err instanceof ApiError ? err.message : String(err));
    }
  }
}

start();
