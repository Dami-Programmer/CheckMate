// Talking to the CheckMate server. Every failure becomes an ApiError with a
// friendly message the popup can show as-is.
import { SERVER_URL } from "./config.js";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export interface Me {
  name: string;
  dailyLimit: number;
  scansLeftToday: number;
}

const NETWORK_MESSAGE = "Can't reach CheckMate right now. Check your internet connection and try again.";
const SERVER_MESSAGE = "Something went wrong on our side. Please try again in a minute.";

async function request<T>(path: string, code: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(SERVER_URL + path, {
      ...init,
      headers: { "content-type": "application/json", "x-invite-code": code, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError("network", NETWORK_MESSAGE, 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? "server", body.message ?? SERVER_MESSAGE, res.status);
  return body as T;
}

export const getMe = (code: string) => request<Me>("/me", code);

export interface Flag {
  type: number;
  name: string;
  color: "red" | "orange" | "green";
  explanation: string;
  quote: string;
}

export interface AnalyzeResult {
  score: number;
  label: string;
  flags: Flag[];
  words: number;
  chunks: number;
  cached: boolean;
  analysisId: number;
}

// New scans can take 10-30 seconds with the real AI; allow up to 70.
// "This flag is wrong": saves a report for the person who sent it. duplicate = they already reported it.
export const report = (code: string, body: { analysisId: number; flag: { type: number; quote: string }; note?: string }) =>
  request<{ ok: true; id: number; duplicate: boolean }>("/report", code, { method: "POST", body: JSON.stringify(body) });

// "Delete my data": removes this person's reports and past scan history on the server.
export const deleteMyData = (code: string) =>
  request<{ ok: true; deleted: { reports: number; days: number } }>("/me/delete", code, { method: "POST", body: "{}" });

// "Forget this document": the server finds the upload's record by the text's fingerprint and removes it.
export const forgetDocument = (code: string, text: string) =>
  request<{ ok: true; forgotten: boolean }>("/forget", code, { method: "POST", body: JSON.stringify({ text }) }, 30000);

// upload: true asks the server not to keep the text (it may be a private contract).
export const analyze = (code: string, page: { url?: string; text: string; upload?: boolean }) =>
  request<AnalyzeResult>("/analyze", code, { method: "POST", body: JSON.stringify(page) }, 70000);
