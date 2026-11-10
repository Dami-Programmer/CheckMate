// Tidies page text so the same document always produces the same text
// (and later the same cache hash), no matter how the page spaced it out.
//
// It only changes spacing. Words and punctuation (including curly quotes)
// are left exactly as they are, so quotes can be checked against this text.

export function cleanText(raw: string): string {
  return (
    raw
      // Windows (\r\n) and old Mac (\r) line endings -> \n
      .replace(/\r\n?/g, "\n")
      // Invisible characters that pages sometimes include
      .replace(/[​-‍﻿]/g, "")
      // Tabs, non-breaking and other odd spaces -> normal space
      .replace(/[\t  -   　]/g, " ")
      // Several spaces in a row -> one space
      .replace(/ {2,}/g, " ")
      // Spaces at the start or end of a line
      .replace(/ *\n */g, "\n")
      // Three or more line breaks -> one blank line (keeps paragraphs)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
