// What the extension remembers on this computer (chrome.storage.local).
export interface Saved {
  inviteCode: string;
  name: string;
}

export async function getSaved(): Promise<Saved | null> {
  const s = await chrome.storage.local.get(["inviteCode", "name"]);
  return typeof s.inviteCode === "string" ? { inviteCode: s.inviteCode, name: String(s.name ?? "") } : null;
}

export const save = (s: Saved) => chrome.storage.local.set(s);
export const forget = () => chrome.storage.local.remove(["inviteCode", "name"]);

// Same clean-up the server does: "  cm-abcd-efgh " -> "CM-ABCD-EFGH".
export const normalizeCode = (input: string) => input.trim().toUpperCase().replace(/\s+/g, "");
