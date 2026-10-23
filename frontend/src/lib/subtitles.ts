import { uid } from "./id";
import type { Line, SubtitleStyle, Word } from "./types";

export const DEFAULT_BOX = { enabled: false, color: "#000000", opacity: 0.6, radius: 16, paddingX: 24, paddingY: 10 };

const base: SubtitleStyle = {
  preset: "classic",
  fontFamily: "montserrat",
  fontWeight: 900,
  fontSize: 72,
  color: "#FFFFFF",
  highlightColor: "#A6E22E",
  outlineColor: "#000000",
  outlineWidth: 6,
  shadowColor: "#000000",
  shadowOpacity: 0,
  shadowOffset: 4,
  box: DEFAULT_BOX,
  position: { preset: "bottom", x: 0.5, y: 0.78 },
  wordsPerScreen: 3,
  uppercase: false,
  animation: "pop",
  karaoke: true,
  wordPop: false,
};

export const SUBTITLE_PRESETS: { id: string; style: SubtitleStyle }[] = [
  {
    id: "classic",
    style: {
      ...base,
      preset: "classic",
      fontFamily: "montserrat",
      fontWeight: 700,
      fontSize: 60,
      outlineWidth: 4,
      shadowOpacity: 0.5,
      shadowOffset: 3,
      position: { preset: "bottom", x: 0.5, y: 0.8 },
      wordsPerScreen: 6,
      animation: "fade",
      karaoke: false,
    },
  },
  {
    id: "tiktok",
    style: {
      ...base,
      preset: "tiktok",
      fontFamily: "montserrat",
      fontWeight: 900,
      fontSize: 80,
      highlightColor: "#FFE600",
      outlineWidth: 8,
      position: { preset: "custom", x: 0.5, y: 0.64 },
      wordsPerScreen: 3,
      uppercase: true,
      animation: "pop",
      karaoke: true,
    },
  },
  {
    id: "karaoke",
    style: {
      ...base,
      preset: "karaoke",
      fontFamily: "rubik",
      fontWeight: 900,
      fontSize: 70,
      highlightColor: "#A6E22E",
      outlineWidth: 6,
      wordsPerScreen: 5,
      animation: "none",
      karaoke: true,
      wordPop: true,
    },
  },
  {
    id: "neon",
    style: {
      ...base,
      preset: "neon",
      fontFamily: "unbounded",
      fontWeight: 900,
      fontSize: 66,
      color: "#C5F25A",
      highlightColor: "#FFFFFF",
      outlineColor: "#0B1A00",
      outlineWidth: 5,
      shadowColor: "#000000",
      shadowOpacity: 0.6,
      shadowOffset: 5,
      position: { preset: "center", x: 0.5, y: 0.5 },
      wordsPerScreen: 2,
      uppercase: true,
      animation: "pop",
      karaoke: true,
    },
  },
  {
    id: "box",
    style: {
      ...base,
      preset: "box",
      fontFamily: "manrope",
      fontWeight: 800,
      fontSize: 56,
      color: "#121214",
      highlightColor: "#FFFFFF",
      outlineWidth: 0,
      box: { enabled: true, color: "#A6E22E", opacity: 1, radius: 18, paddingX: 26, paddingY: 12 },
      wordsPerScreen: 4,
      animation: "slide",
      karaoke: false,
    },
  },
  {
    id: "minimal",
    style: {
      ...base,
      preset: "minimal",
      fontFamily: "inter",
      fontWeight: 400,
      fontSize: 50,
      outlineWidth: 0,
      shadowOpacity: 0.75,
      shadowOffset: 2,
      position: { preset: "bottom", x: 0.5, y: 0.86 },
      wordsPerScreen: 7,
      animation: "fade",
      karaoke: false,
    },
  },
];

export const POSITION_PRESETS = { top: 0.16, center: 0.5, bottom: 0.78 } as const;

export function presetStyle(id: string): SubtitleStyle {
  const p = SUBTITLE_PRESETS.find((x) => x.id === id) ?? SUBTITLE_PRESETS[0];
  return structuredClone(p.style);
}

// ------------------------------------------------------------------ line editing

export function lineSpan(line: Line): [number, number] {
  if (!line.words.length) return [0, 0];
  return [line.words[0].start, Math.max(...line.words.map((w) => w.end))];
}

export function lineText(line: Line): string {
  return line.words.map((w) => w.text).join(" ");
}

/** Replace the text of a line, keeping word timings when possible. */
export function editLineText(line: Line, text: string): Line {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { ...line, words: [] };
  if (tokens.length === line.words.length) {
    return { ...line, words: line.words.map((w, i) => ({ ...w, text: tokens[i] })) };
  }
  const [start, end] = lineSpan(line);
  const total = Math.max(0.1 * tokens.length, end - start);
  const chars = tokens.reduce((s, t) => s + t.length + 1, 0);
  let t = start;
  const words: Word[] = tokens.map((tok) => {
    const d = (total * (tok.length + 1)) / chars;
    const w = { text: tok, start: round3(t), end: round3(t + d * 0.92) };
    t += d;
    return w;
  });
  return { ...line, words };
}

/** Number of whole words before the caret (a caret inside a word splits before it). */
export function wordIndexAtCaret(text: string, caret: number): number {
  const before = text.slice(0, caret);
  const count = before.split(/\s+/).filter(Boolean).length;
  const insideWord = caret < text.length && !/\s/.test(text[caret]) && before.length > 0 && !/\s$/.test(before);
  return insideWord ? count - 1 : count;
}

export function splitLine(lines: Line[], lineId: string, wordIndex: number): Line[] {
  return lines.flatMap((l) => {
    if (l.id !== lineId || wordIndex <= 0 || wordIndex >= l.words.length) return [l];
    return [
      { ...l, words: l.words.slice(0, wordIndex) },
      { id: uid(), words: l.words.slice(wordIndex) },
    ];
  });
}

export function mergeWithNext(lines: Line[], lineId: string): Line[] {
  const i = lines.findIndex((l) => l.id === lineId);
  if (i < 0 || i >= lines.length - 1) return lines;
  const merged = { ...lines[i], words: [...lines[i].words, ...lines[i + 1].words] };
  return [...lines.slice(0, i), merged, ...lines.slice(i + 2)];
}

export function shiftLine(lines: Line[], lineId: string, delta: number): Line[] {
  return lines.map((l) => {
    if (l.id !== lineId || !l.words.length) return l;
    const d = Math.max(delta, -l.words[0].start);
    return { ...l, words: l.words.map((w) => ({ ...w, start: round3(w.start + d), end: round3(w.end + d) })) };
  });
}

export function deleteLine(lines: Line[], lineId: string): Line[] {
  return lines.filter((l) => l.id !== lineId);
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Same grouping as backend/app/worker/transcribe.py:group_words. */
export function groupWords(words: Word[], maxWords = 7, maxChars = 36, maxGap = 0.7, maxDuration = 4): Line[] {
  const out: Line[] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (cur.length) {
      const chars = cur.reduce((s, x) => s + x.text.length + 1, 0) + w.text.length;
      if (
        cur.length >= maxWords ||
        chars > maxChars ||
        w.start - cur[cur.length - 1].end > maxGap ||
        w.end - cur[0].start > maxDuration
      ) {
        out.push({ id: uid(), words: cur });
        cur = [];
      }
    }
    cur.push(w);
    if (/[.!?…]+[»"')]*$/.test(w.text)) {
      out.push({ id: uid(), words: cur });
      cur = [];
    }
  }
  if (cur.length) out.push({ id: uid(), words: cur });
  return out;
}
