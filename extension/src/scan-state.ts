// The state of the scan for each tab, kept in chrome.storage.session (cleared
// when the browser closes). The background worker writes it; the popup reads
// it, so closing and reopening the popup never loses a scan.
import type { AnalyzeResult } from "./api.js";

export type ScanState = { url: string; title: string; startedAt: number; words?: number } & (
  | { status: "scanning" }
  | { status: "done"; result: AnalyzeResult }
  | { status: "error"; error: { code: string; message: string } }
);

export const stateKey = (tabId: number) => `scan:${tabId}`;

export async function getScanState(tabId: number): Promise<ScanState | null> {
  const key = stateKey(tabId);
  const s = await chrome.storage.session.get(key);
  return (s[key] as ScanState | undefined) ?? null;
}

export const setScanState = (tabId: number, state: ScanState) => chrome.storage.session.set({ [stateKey(tabId)]: state });
export const clearScanState = (tabId: number) => chrome.storage.session.remove(stateKey(tabId));

// Message the panel sends when someone says a flag is wrong (the panel can't call the server itself).
export interface ReportRequest {
  type: "report";
  analysisId: number;
  flag: { type: number; quote: string };
  note?: string;
}
export type ReportResponse = { ok: true; duplicate: boolean } | { ok: false; message: string };

// Message the popup sends to the background worker.
export interface ScanRequest {
  type: "scan";
  tabId: number;
  page: { url: string; title: string; text: string; upload?: boolean }; // upload: a file from the upload page
}
