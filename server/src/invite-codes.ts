// Invite codes look like CM-7KQX-M3PD.
// The letters skip look-alikes (0/O, 1/I/L) so codes are easy to read out and type.

import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateInviteCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `CM-${part()}-${part()}`;
}

// Accepts codes typed with lowercase or extra spaces: " cm-7kqx-m3pd " -> "CM-7KQX-M3PD".
export function normalizeInviteCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}
