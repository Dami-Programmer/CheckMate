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
