// "Explain simply" buttons beside each highlighted clause. Clicking one opens
// an "In simple words" card: what it says, what it means for you, what you can
// do, the hard words explained, and a "Read it to me" button.
import { findRanges } from "./highlight.js";
import css from "./markers.css";
import { hardWordsIn, SIMPLE } from "./simple.js";
import { applyCss, h } from "./ui.js";

export interface MarkerItem {
  quote: string;
  color: "red" | "orange" | "green";
  type: number;
  name: string;
}

const HOST_ID = "checkmate-markers-host";
const BTN_H = 30; // button height
const GAP = 6; // space between stacked buttons
const FULL_W = 140; // width of the full "Explain simply" pill
let current: { host: HTMLElement; cleanup: () => void; reposition: () => void } | null = null;

// Where the floating CheckMate panel is on screen. The "Explain simply"
// buttons and their card always go on the OTHER side, so they never hide
// behind it. The panel calls setPanelBox whenever it moves.
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
let panelBox: Box | null = null;
export function setPanelBox(box: Box | null) {
  panelBox = box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
  current?.reposition();
}
// "left" if the panel sits on the left half of the screen, otherwise "right"
// (it starts in the top-right corner).
const panelSide = () => (panelBox && (panelBox.left + panelBox.right) / 2 < window.innerWidth / 2 ? "left" : "right");

export function removeMarkers() {
  if (!current) return;
  current.cleanup();
  current.host.remove();
  current = null;
}

export function showMarkers(items: MarkerItem[]) {
  removeMarkers();
  const ranges = findRanges(items.map((i) => i.quote));
  if (!ranges.some(Boolean)) return;

  // An absolutely positioned layer at the top-left of the page, so buttons
  // scroll together with the text they belong to.
  const host = h("div", { id: HOST_ID });
  host.style.cssText = "all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;";
  const shadow = host.attachShadow({ mode: "closed" });
  applyCss(shadow, css);
  document.documentElement.appendChild(host);

  // The "In simple words" card gets its own top layer, so it always opens
  // above everything, including the CheckMate panel.
  const popHost = h("div", { id: "checkmate-explain-host" });
  popHost.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
  const popShadow = popHost.attachShadow({ mode: "closed" });
  applyCss(popShadow, css);
  (globalThis as any).__checkmateMarkersTestHook?.(shadow, popShadow);

  // The open "In simple words" card, if any, and the button it belongs to.
  let pop: HTMLElement | null = null;
  let openFor: HTMLButtonElement | null = null;

  // ----- One button per clause found on the page -----
  const buttons: { btn: HTMLButtonElement; range: Range; item: MarkerItem }[] = [];
  ranges.forEach((range, idx) => {
    if (!range) return;
    const item = items[idx]!;
    const btn = h(
      "button",
      { type: "button", class: `mk ${item.color}`, title: `Explain “${item.name}” in simple words`, ariaLabel: `Explain in simple words: ${item.name}`, style: `--i:${buttons.length}` },
      h("span", { class: "mk-icon", ariaHidden: "true" }, "💡"),
      h("span", { class: "mk-label" }, "Explain simply")
    );
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openFor === btn) closePop();
      else openPop(btn, item);
    });
    shadow.append(btn);
    buttons.push({ btn, range, item });
  });

  // The block of text (paragraph, list item...) a clause sits in.
  const blockOf = (range: Range): Element | null => {
    let n: Node | null = range.startContainer;
    let el = n.nodeType === 1 ? (n as Element) : n.parentElement;
    while (el && el !== document.body) {
      const d = getComputedStyle(el).display;
      if (d !== "inline" && d !== "contents") return el;
      el = el.parentElement;
    }
    return document.body;
  };

  // Where each button goes, always on the side AWAY from the CheckMate panel:
  //  1. In the empty margin beside the text, lined up with the start of its
  //     clause (covers nothing), when that margin has room;
  //  2. otherwise (narrow window) a compact round 💡 at that side of the clause:
  //     just before it starts, or just after it ends.
  // Buttons in the same spot are stacked so they never overlap.
  const position = () => {
    const pageW = document.documentElement.clientWidth;
    const side = panelSide() === "right" ? "left" : "right"; // where the buttons go
    const placed: { x: number; y: number; w: number }[] = [];
    const spots = buttons.map(({ btn, range }) => {
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) return { btn, hidden: true, x: 0, y: 0, side: false };
      const first = rects[0]!;
      const last = rects[rects.length - 1]!;
      const block = blockOf(range)?.getBoundingClientRect();
      const textLeft = Math.min(block ? block.left : first.left, ...rects.map((r) => r.left));
      const textRight = Math.max(block ? block.right : last.right, ...rects.map((r) => r.right));
      const firstLineY = first.top + window.scrollY + first.height / 2 - BTN_H / 2;
      if (side === "left" && textLeft >= FULL_W + 16) {
        return { btn, hidden: false, side: true, x: textLeft - 10 - FULL_W + window.scrollX, y: firstLineY };
      }
      if (side === "right" && pageW - textRight >= FULL_W + 16) {
        return { btn, hidden: false, side: true, x: textRight + 10 + window.scrollX, y: firstLineY };
      }
      // No room in that margin: a compact round 💡 on that side of the clause.
      if (side === "left" && first.left - BTN_H - 4 >= 4) {
        return { btn, hidden: false, side: false, x: first.left - BTN_H - 4 + window.scrollX, y: firstLineY };
      }
      const x = Math.min(last.right + 4, pageW - BTN_H - 4);
      return { btn, hidden: false, side: false, x: Math.max(4, x) + window.scrollX, y: last.top + window.scrollY + last.height / 2 - BTN_H / 2 };
    });
    spots.sort((a, b) => a.y - b.y);
    for (const s of spots) {
      s.btn.hidden = s.hidden;
      if (s.hidden) continue;
      const w = s.side ? FULL_W : BTN_H;
      s.btn.classList.toggle("side", s.side);
      s.btn.classList.toggle("compact", !s.side);
      // Push down while it overlaps a button already placed.
      for (let again = true; again; ) {
        again = false;
        for (const p of placed) {
          if (s.x < p.x + p.w && p.x < s.x + w && s.y < p.y + BTN_H + GAP && p.y < s.y + BTN_H + GAP) {
            s.y = p.y + BTN_H + GAP;
            again = true;
          }
        }
      }
      placed.push({ x: s.x, y: s.y, w });
      s.btn.style.left = `${Math.round(s.x)}px`;
      s.btn.style.top = `${Math.round(s.y)}px`;
    }
    if (openFor && pop) placePop(openFor, pop);
  };
  position();

  // ----- The "In simple words" card -----

  const stopSpeaking = () => {
    try {
      speechSynthesis.cancel();
    } catch {
      /* speech not available */
    }
  };

  function closePop() {
    stopSpeaking();
    pop?.remove();
    pop = null;
    openFor?.classList.remove("open");
    openFor = null;
  }

  function placePop(btn: HTMLElement, el: HTMLElement) {
    const b = btn.getBoundingClientRect();
    const w = el.offsetWidth || 330;
    const hgt = el.offsetHeight || 300;
    // The free strip of screen on the side away from the panel.
    let from = 12;
    let to = window.innerWidth - 12;
    if (panelBox) {
      if (panelSide() === "right") to = Math.min(to, panelBox.left - 12);
      else from = Math.max(from, panelBox.right + 12);
    }
    if (to - from < w) {
      from = 12; // not enough room beside the panel: use the whole width (the card sits on top)
      to = window.innerWidth - 12;
    }
    let left = b.left + b.width / 2 - w / 2;
    left = Math.min(Math.max(from, left), to - w);
    // Below the button if it fits, otherwise above.
    let top = b.bottom + 10;
    if (top + hgt > window.innerHeight - 12) top = Math.max(12, b.top - hgt - 10);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function openPop(btn: HTMLButtonElement, item: MarkerItem) {
    closePop();
    const simple = SIMPLE[item.type];
    const hard = hardWordsIn(item.quote);
    const speakText = [
      item.name + ".",
      simple ? `What it says: ${simple.says}` : "",
      simple ? `What it means for you: ${simple.means}` : "",
      simple ? `What you can do: ${simple.tip}` : "",
      ...hard.map((w) => `${w.word} means: ${w.meaning}`),
    ].join(" ");

    const speak = h("button", { type: "button", class: "speak" }, "🔊 Read it to me");
    let speaking = false;
    speak.addEventListener("click", () => {
      if (speaking) {
        stopSpeaking();
        return;
      }
      try {
        stopSpeaking();
        const u = new SpeechSynthesisUtterance(speakText);
        u.rate = 0.92;
        u.onstart = () => {
          speaking = true;
          speak.textContent = "⏹ Stop reading";
        };
        u.onend = u.onerror = () => {
          speaking = false;
          speak.textContent = "🔊 Read it to me";
        };
        speechSynthesis.speak(u);
      } catch {
        speak.textContent = "Reading aloud isn't available here";
        speak.disabled = true;
      }
    });

    const x = h("button", { type: "button", class: "x", title: "Close", ariaLabel: "Close" }, "×");
    x.addEventListener("click", () => closePop());

    const section = (title: string, text: string) => [h("h4", {}, title), h("p", {}, text)];
    pop = h(
      "div",
      { class: `pop ${item.color}`, role: "dialog", ariaLabel: `In simple words: ${item.name}` },
      h("div", { class: "pop-head" }, h("span", { class: "pop-title" }, "In simple words"), x),
      h("div", { class: "pop-sub" }, item.name),
      ...(simple
        ? [...section("What it says", simple.says), ...section("What it means for you", simple.means), ...section("What you can do", simple.tip)]
        : []),
      ...(hard.length
        ? [h("h4", {}, "Hard words in this part"), h("ul", {}, ...hard.map((w) => h("li", {}, h("b", {}, w.word), ` = ${w.meaning}`)))]
        : []),
      h("div", { class: "pop-foot" }, speak, h("span", { class: "note" }, "A simple guide, not legal advice."))
    );
    popShadow.append(pop);
    document.documentElement.appendChild(popHost); // (re)attach last, so it sits on top
    openFor = btn;
    btn.classList.add("open");
    placePop(btn, pop);
    x.focus({ preventScroll: true });
  }

  // ----- Keep everything in place; close the card on Esc or a click elsewhere -----
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && pop) closePop();
  };
  const onDocDown = (e: PointerEvent) => {
    const path = e.composedPath();
    if (pop && !path.includes(host) && !path.includes(popHost)) closePop();
  };
  const onScroll = () => {
    if (openFor && pop) placePop(openFor, pop);
  };
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(position);
  };
  const ro = new ResizeObserver(schedule);
  ro.observe(document.body);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onDocDown, true);
  const timer = window.setInterval(position, 2000); // pages that shift without resizing

  current = {
    host,
    reposition: schedule,
    cleanup: () => {
      closePop();
      popHost.remove();
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearInterval(timer);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDocDown, true);
    },
  };
}
