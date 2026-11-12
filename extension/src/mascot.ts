// The CheckMate "reader": the user's illustration, animated while a scan runs.
//
// The artwork is drawn onto <canvas> elements from the embedded PNG bytes (not
// an <img>), so a page's strict image rules can't block it. On top of it sit:
//   - an SVG layer with the eyes and the mouth (lifted off the picture so they
//     can move): the eyes scan along the lines, the mouth mumbles;
//   - a copy of the book's right-hand page that flips over.
// Everything is positioned in the picture's own pixel coordinates (see ART).
// Modes: idle (calm), running (reading), done (smiling + ✓), error (puzzled + !).
import baseUrl from "./assets/reader-base.png";
import flipUrl from "./assets/reader-flip.png";
import { h } from "./ui.js";

// The trimmed picture, and the right-hand page, in the source picture's pixels.
const ART = { x: 96, y: 228, w: 544, h: 320 };
const FLIP = { x: 449, y: 409, w: 163, h: 74 };

// Where the lenses are (to keep the pupils inside the glasses).
const LENS_L = "M432 330 L438 326 L452 330 L466 338 L470 345 L466 352 L458 359 L448 362 L439 358 L433 350 L431 340 Z";
const LENS_R = "M482 344 L492 346 L503 349 L506 356 L502 364 L496 370 L489 372 L483 368 L481 356 Z";

export type MascotMode = "idle" | "running" | "done" | "error";
export interface Mascot {
  el: HTMLElement;
  setMode(mode: MascotMode): void;
}

// ---------- Drawing the PNGs without an <img> ----------
const bitmaps = new Map<string, Promise<ImageBitmap>>();
function bitmapFrom(dataUrl: string): Promise<ImageBitmap> {
  let p = bitmaps.get(dataUrl);
  if (!p) {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    p = createImageBitmap(new Blob([bytes], { type: "image/png" }));
    bitmaps.set(dataUrl, p);
  }
  return p;
}
function paint(canvas: HTMLCanvasElement, dataUrl: string) {
  bitmapFrom(dataUrl)
    .then((bm) => {
      canvas.width = bm.width;
      canvas.height = bm.height;
      canvas.getContext("2d")!.drawImage(bm, 0, 0);
      canvas.dataset.ready = "1";
    })
    .catch(() => {
      canvas.dataset.failed = "1";
    });
}

// ---------- The face layer (SVG) ----------
const NS = "http://www.w3.org/2000/svg";
function s(tag: string, attrs: Record<string, string | number> = {}, ...kids: Element[]) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

function faceLayer() {
  // Pupils are drawn a little bigger than the originals so they read at small sizes.
  const pupil = (cx: number, cy: number, clip: string) =>
    s("g", { "clip-path": `url(#${clip})` }, s("ellipse", { class: "m-pupil", cx, cy, rx: 7, ry: 7.6 }));
  return s(
    "svg",
    { class: "m-face", viewBox: `${ART.x} ${ART.y} ${ART.w} ${ART.h}`, "aria-hidden": "true" },
    s("defs", {}, s("clipPath", { id: "cm-lens-l" }, s("path", { d: LENS_L })), s("clipPath", { id: "cm-lens-r" }, s("path", { d: LENS_R }))),
    pupil(455, 354, "cm-lens-l"),
    pupil(490, 366, "cm-lens-r"),
    // the mouth, in four shapes; CSS shows the right one
    s("path", { class: "m-mouth dash", d: "M433.5 379.5 Q436 385 441.5 388.5" }),
    s("ellipse", { class: "m-mouth o", cx: 438, cy: 383.5, rx: 6.2, ry: 7.6 }),
    s("path", { class: "m-mouth smile", d: "M429 379 Q438 393 448 379" }),
    s("path", { class: "m-mouth wavy", d: "M430 386 q4 -4.5 8 0 t8 0" })
  );
}

// ---------- The whole thing ----------
export function createMascot(): Mascot {
  const base = h("canvas", { class: "m-base" });
  // Three copies of the page, each turning at a different moment, so a page is nearly always in the air.
  const flips = ["f1", "f2", "f3"].map((n) => {
    const flip = h("canvas", { class: `m-flip ${n}` });
    // position it over the book (CSSOM, so strict page rules can't block it)
    flip.style.left = `${((FLIP.x - ART.x) / ART.w) * 100}%`;
    flip.style.top = `${((FLIP.y - ART.y) / ART.h) * 100}%`;
    flip.style.width = `${(FLIP.w / ART.w) * 100}%`;
    flip.style.aspectRatio = `${FLIP.w} / ${FLIP.h}`;
    paint(flip, flipUrl);
    return flip;
  });
  const badge = h("span", { class: "m-badge" });
  const el = h("div", { class: "mascot idle", ariaHidden: "true" }, base, ...flips, faceLayer() as unknown as Node, badge);
  paint(base, baseUrl);

  return {
    el,
    setMode(mode) {
      el.className = `mascot ${mode}`;
      badge.textContent = mode === "done" ? "✓" : mode === "error" ? "!" : "";
    },
  };
}
