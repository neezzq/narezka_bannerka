// Timeline semantics shared with the export — mirrors backend/app/render/timeline.py.
// Both are tested against shared/fixtures/timeline.json.
import type { Cut, Line, SubtitleStyle } from "./types";

export const GAP_FILL = 0.4;
export const MIN_PAGE = 0.1;
export const LINE_ANIM = 0.2;
export const POP_SCALE_FROM = 0.6;
export const SLIDE_PX = 40;
export const WORD_POP = 1.2;
export const WORD_POP_DUR = 0.1;
/** Lines wider than this fraction of the frame are scaled down to fit. */
export const MAX_LINE_WIDTH = 0.92;

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function outputDuration(cuts: Cut[]): number {
  return cuts.reduce((s, c) => s + (c.end - c.start), 0);
}

export function sourceToOutput(cuts: Cut[], t: number): number | null {
  let offset = 0;
  for (const c of cuts) {
    if (c.start <= t && t < c.end) return offset + (t - c.start);
    offset += c.end - c.start;
  }
  return null;
}

/** Output time → [cut index, source time]. Clamped to the timeline. */
export function outputToSource(cuts: Cut[], t: number): { index: number; source: number } {
  let offset = 0;
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i];
    const d = c.end - c.start;
    if (t < offset + d || i === cuts.length - 1) {
      return { index: i, source: Math.min(c.end, c.start + Math.max(0, t - offset)) };
    }
    offset += d;
  }
  return { index: 0, source: 0 };
}

export function cutOffsets(cuts: Cut[]): number[] {
  const out: number[] = [];
  let offset = 0;
  for (const c of cuts) {
    out.push(offset);
    offset += c.end - c.start;
  }
  return out;
}

export function mapInterval(cuts: Cut[], start: number, end: number): [number, number] | null {
  let offset = 0;
  if (end <= start) end = start + 0.05;
  for (const c of cuts) {
    const a = Math.max(start, c.start);
    const b = Math.min(end, c.end);
    if (b - a > 0.01) return [r4(offset + a - c.start), r4(offset + b - c.start)];
    offset += c.end - c.start;
  }
  return null;
}

export interface PWord {
  text: string;
  start: number;
  end: number;
}

export interface Page {
  words: PWord[];
  start: number;
  end: number;
  lineId: string;
  text: string;
}

export function transformText(text: string, style: Pick<SubtitleStyle, "uppercase">): string {
  const t = text.split(/\s+/).filter(Boolean).join(" ");
  return style.uppercase ? t.toUpperCase() : t;
}

export function buildPages(
  lines: Line[],
  cuts: Cut[],
  style: Pick<SubtitleStyle, "wordsPerScreen" | "uppercase">,
): Page[] {
  const n = Math.max(1, style.wordsPerScreen);
  const pages: Page[] = [];
  for (const line of lines) {
    const mapped: PWord[] = [];
    for (const w of line.words) {
      const text = transformText(w.text, style);
      if (!text) continue;
      const iv = mapInterval(cuts, w.start, w.end);
      if (!iv) continue;
      mapped.push({ text, start: iv[0], end: iv[1] });
    }
    mapped.sort((a, b) => a.start - b.start);
    for (let i = 0; i < mapped.length; i += n) {
      const chunk = mapped.slice(i, i + n);
      pages.push({
        words: chunk,
        start: chunk[0].start,
        end: Math.max(...chunk.map((w) => w.end)),
        lineId: line.id,
        text: chunk.map((w) => w.text).join(" "),
      });
    }
  }
  pages.sort((a, b) => a.start - b.start);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const next = pages[i + 1];
    if (page.end - page.start < MIN_PAGE) page.end = page.start + MIN_PAGE;
    if (next) {
      if (next.start - page.end < GAP_FILL) page.end = next.start;
      page.end = Math.min(page.end, next.start);
    }
    page.start = r4(page.start);
    page.end = r4(page.end);
  }
  return pages.filter((p) => p.end > p.start);
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Uniform scale (≤ 1) keeping the page (text + box + outline) inside the frame. */
export function fitScale(textW: number, style: SubtitleStyle, frameW: number): number {
  const w = textW + 2 * style.outlineWidth + (style.box.enabled ? 2 * style.box.paddingX : 0);
  return w > 0 ? Math.min(1, (MAX_LINE_WIDTH * frameW) / w) : 1;
}

export function lineAnimState(style: SubtitleStyle, pageStart: number, t: number) {
  if (style.animation === "none") return { alpha: 1, scale: 1, dy: 0 };
  const p = clamp01((t - pageStart) / LINE_ANIM);
  if (style.animation === "fade") return { alpha: p, scale: 1, dy: 0 };
  if (style.animation === "pop") return { alpha: p, scale: POP_SCALE_FROM + (1 - POP_SCALE_FROM) * p, dy: 0 };
  return { alpha: p, scale: 1, dy: SLIDE_PX * (1 - p) };
}

export function activeWord(page: Page, t: number): number {
  let k = 0;
  page.words.forEach((w, i) => {
    if (w.start <= t) k = i;
  });
  return k;
}

export function wordScale(style: SubtitleStyle, wordStart: number, t: number): number {
  if (!style.wordPop) return 1;
  return 1 + (WORD_POP - 1) * clamp01((t - wordStart) / WORD_POP_DUR);
}

export function pageAt(pages: Page[], t: number): Page | null {
  // pages are sorted and non-overlapping
  let lo = 0;
  let hi = pages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pages[mid];
    if (t < p.start) hi = mid - 1;
    else if (t >= p.end) lo = mid + 1;
    else return p;
  }
  return null;
}
