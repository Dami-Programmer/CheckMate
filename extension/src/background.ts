// Background service worker. It runs scans so they keep going even if the
// popup closes, and saves each tab's scan state for the popup to show.
import { analyze, ApiError, report } from "./api.js";
import { clearScanState, setScanState, type ReportRequest, type ReportResponse, type ScanRequest } from "./scan-state.js";
import { getSaved } from "./storage.js";

// Let the floating panel (which runs inside the page, in CheckMate's own
// isolated script world) read scan progress. Web pages themselves still can't.
try {
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});
} catch {
  // very old Chrome: the panel will show "no results" instead of crashing the worker
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`CheckMate ${chrome.runtime.getManifest().version} ${details.reason}`);
});

// Saves "scanning" for the tab, then returns `finish`, which does the actual scan.
async function startScan({ tabId, page }: ScanRequest) {
  const words = page.text.split(/\s+/).filter(Boolean).length;
  const base = { url: page.url, title: page.title, startedAt: Date.now(), words };
  await setScanState(tabId, { ...base, status: "scanning" });
  return () => finishScan(tabId, page, base);
}

async function finishScan(tabId: number, page: ScanRequest["page"], base: { url: string; title: string; startedAt: number; words: number }) {
  const saved = await getSaved();
  if (!saved) {
    await setScanState(tabId, { ...base, status: "error", error: { code: "invalid_code", message: "Please enter your invite code first." } });
    return;
  }
  try {
    // Uploads: no address is sent (the upload page's address means nothing), and the server keeps only a fingerprint.
    const result = await analyze(saved.inviteCode, page.upload ? { text: page.text, upload: true } : { url: page.url, text: page.text });
    await setScanState(tabId, { ...base, status: "done", result });
  } catch (err) {
    const error =
      err instanceof ApiError
        ? { code: err.code, message: page.upload ? documentWording(err.code, err.message) : err.message }
        : { code: "unknown", message: "Something went wrong. Please try again." };
    await setScanState(tabId, { ...base, status: "error", error });
  }
}

// The server's messages talk about "pages"; say "document" for uploads.
function documentWording(code: string, message: string) {
  if (code === "too_short") return "This document doesn't look like terms, a contract or a privacy policy.";
  if (code === "too_long") return "This document is too long to check. Try uploading just the terms part.";
  return message;
}

async function sendReport(msg: ReportRequest): Promise<ReportResponse> {
  const saved = await getSaved();
  if (!saved) return { ok: false, message: "Enter your invite code first: click the CheckMate icon." };
  try {
    const res = await report(saved.inviteCode, { analysisId: msg.analysisId, flag: msg.flag, note: msg.note || undefined });
    return { ok: true, duplicate: res.duplicate };
  } catch (err) {
    return { ok: false, message: err instanceof ApiError ? err.message : "Couldn't send it. Please try again." };
  }
}

chrome.runtime.onMessage.addListener((msg: ScanRequest | ReportRequest | { type: "ping" }, _sender, sendResponse) => {
  if (msg?.type === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }
  if (msg?.type === "report") {
    sendReport(msg).then(sendResponse);
    return true; // we answer asynchronously
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
