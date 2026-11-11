// Splits long (cleaned) text into pieces small enough for one AI call.
//
// - Each chunk is about `maxWords` words.
// - Chunks break between paragraphs, so sentences stay whole.
// - The last ~`overlapWords` words of one chunk are repeated at the start of
//   the next, so a clause sitting on the boundary is seen in full at least once.

export interface ChunkOptions {
  maxWords?: number;
  overlapWords?: number;
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Break text into pieces no bigger than maxWords: paragraphs first,
// then sentences for a giant paragraph, then plain words as a last resort.
function toPieces(text: string, maxWords: number): string[] {
  const pieces: string[] = [];
  for (const para of text.split(/\n\n+/)) {
    if (!para.trim()) continue;
    if (countWords(para) <= maxWords) {
      pieces.push(para);
      continue;
    }
    for (const sentence of para.split(/(?<=[.!?;:])\s+/)) {
      const words = sentence.split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i += maxWords) {
        pieces.push(words.slice(i, i + maxWords).join(" "));
      }
    }
  }
  return pieces;
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxWords = options.maxWords ?? 3000;
  const overlapWords = options.overlapWords ?? 150;

  const pieces = toPieces(text, maxWords);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const piece of pieces) {
    const words = countWords(piece);
    if (currentWords + words > maxWords && current.length > 0) {
      chunks.push(current.join("\n\n"));
      // Start the next chunk with the tail of this one (the overlap).
      const overlap: string[] = [];
      let overlapCount = 0;
      for (let i = current.length - 1; i >= 0 && overlapCount < overlapWords; i--) {
        const w = countWords(current[i]!);
        if (overlapCount + w > overlapWords && overlap.length > 0) break;
        if (w > overlapWords) break; // a single huge paragraph is too big to repeat
        overlap.unshift(current[i]!);
        overlapCount += w;
      }
      current = overlap;
      currentWords = overlapCount;
    }
    current.push(piece);
    currentWords += words;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}
