// Background service worker. It runs scans so they keep going even if the
// popup closes, and saves each tab's scan state for the popup to show.
import { analyze, ApiError } from "./api.js";
import { clearScanState, setScanState, type ScanRequest } from "./scan-state.js";
import { getSaved } from "./storage.js";

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`CheckMate ${chrome.runtime.getManifest().version} ${details.reason}`);
});

// Saves "scanning" for the tab, then returns `finish`, which does the actual scan.
async function startScan({ tabId, page }: ScanRequest) {
  const base = { url: page.url, title: page.title, startedAt: Date.now() };
  await setScanState(tabId, { ...base, status: "scanning" });
  return () => finishScan(tabId, page, base);
}

async function finishScan(tabId: number, page: ScanRequest["page"], base: { url: string; title: string; startedAt: number }) {
  const saved = await getSaved();
  if (!saved) {
    await setScanState(tabId, { ...base, status: "error", error: { code: "invalid_code", message: "Please enter your invite code first." } });
    return;
  }
  try {
    const result = await analyze(saved.inviteCode, { url: page.url, text: page.text });
    await setScanState(tabId, { ...base, status: "done", result });
  } catch (err) {
    const error =
      err instanceof ApiError
        ? { code: err.code, message: err.message }
        : { code: "unknown", message: "Something went wrong. Please try again." };
    await setScanState(tabId, { ...base, status: "error", error });
  }
}

chrome.runtime.onMessage.addListener((msg: ScanRequest | { type: "ping" }, _sender, sendResponse) => {
  if (msg?.type === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }
  if (msg?.type !== "scan") return;
  // Answer "started" right away so the popup knows the scan is running,
  // then do the scan (its progress is saved for the popup to follow).
  startScan(msg)
    .then((finish) => {
      sendResponse({ ok: true });
      return finish();
    })
    .catch((err) => {
      console.error("CheckMate scan failed to start", err);
      sendResponse({ ok: false });
    });
  return true; // we answer asynchronously
});

// Forget a tab's scan when the tab is closed.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearScanState(tabId);
});
