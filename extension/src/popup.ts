// The popup: everything the person sees when they click the CheckMate icon.
import { ApiError, getMe, type Me } from "./api.js";
import { VERSION } from "./config.js";
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

// ---------- Home screen: ready to scan ----------
function showHome(saved: Saved, me?: Me) {
  const scansLine = h(
    "p",
    { class: "muted", id: "scans-left" },
    me ? `${me.scansLeftToday} of ${me.dailyLimit} new scans left today.` : "Checking your scans for today…"
  );
  const change = h("button", { type: "button", class: "link" }, "Use a different code");
  change.addEventListener("click", async () => {
    await forget();
    showWelcome();
  });

  show(
    h("h2", {}, saved.name ? `Hi, ${saved.name}.` : "Hi there."),
    h("button", { type: "button", class: "primary", id: "scan", disabled: true }, "Scan this page"),
    h("p", { class: "muted small" }, "(Scanning arrives in the next step.)"),
    scansLine,
    h("p", { class: "muted small" }, "Pages someone already scanned are free and don't count."),
    change
  );
}

// ---------- Start ----------
async function start() {
  const saved = await getSaved();
  if (!saved) return showWelcome();

  showHome(saved); // show straight away, then refresh from the server
  try {
    const me = await getMe(saved.inviteCode);
    if (me.name !== saved.name) await save({ ...saved, name: me.name });
    showHome({ ...saved, name: me.name }, me);
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
