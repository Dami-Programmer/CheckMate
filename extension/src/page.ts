// Reads the text of the tab the person is looking at.
import type { Extracted } from "./extract-core.js";

export const MIN_WORDS = 200;

export interface PageText extends Extracted {
  url: string;
}

export class PageError extends Error {
  constructor(public code: "cant_read" | "too_short", message: string) {
    super(message);
  }
}

export async function readCurrentPage(): Promise<PageText & { tabId: number }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new PageError("cant_read", "CheckMate can't find the page you're on. Click on the page, then try again.");

  let page: PageText | undefined;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis as any).__checkmateExtract(),
    });
    page = res?.result as PageText | undefined;
  } catch {
    // Chrome blocks extensions on its own pages, the Web Store and some PDFs.
  }
  if (!page) {
    throw new PageError(
      "cant_read",
      "CheckMate can't read this kind of page (for example Chrome settings, the Web Store or some PDFs). Open the terms page in a normal tab and try again."
    );
  }
  if (page.words < MIN_WORDS) {
    throw new PageError(
      "too_short",
      "This page doesn't have enough text to scan. Open the full terms of service or privacy policy page and try again."
    );
  }
  return { ...page, tabId: tab.id };
}
