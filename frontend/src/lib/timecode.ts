import { t } from "@/i18n";

// Mirrors backend/app/services/timecode.py

const TC = /^\s*(?:(\d+):)?(?:(\d+):)?(\d+(?:[.,]\d+)?)\s*$/;
const RANGE_SEP = /\s*(?:-|–|—|\.\.|\bto\b|\s+до\s+)\s*/i;

export class TimecodeError extends Error {}

export function parseTimecode(value: string): number {
  const text = (value ?? "").trim();
  const m = TC.exec(text);
  if (!m) throw new TimecodeError(t("timecode.invalid", { text }));
  const [, a, b, last] = m;
  const seconds = parseFloat(last.replace(",", "."));
  let hours = 0;
  let minutes = 0;
  if (a !== undefined && b !== undefined) {
    hours = parseInt(a, 10);
    minutes = parseInt(b, 10);
  } else if (a !== undefined) {
    minutes = parseInt(a, 10);
  }
  if (a !== undefined) {
    if (seconds >= 60) throw new TimecodeError(t("timecode.seconds", { text }));
    if (b !== undefined && minutes >= 60) throw new TimecodeError(t("timecode.minutes", { text }));
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/** "1:23-2:10" → [83, 130], or null when the text is not a range */
export function parseRange(value: string): [number, number] | null {
  const parts = (value ?? "")
    .trim()
    .split(RANGE_SEP)
    .filter((p) => p.trim());
  if (parts.length !== 2) return null;
  const start = parseTimecode(parts[0]);
  const end = parseTimecode(parts[1]);
  if (end <= start) throw new TimecodeError(t("timecode.order"));
  return [start, end];
}

export function formatTimecode(seconds: number, fraction = false): string {
  const s0 = Math.max(0, seconds || 0);
  let whole: number;
  let tenths = 0;
  if (fraction) {
    const total = Math.round(s0 * 10);
    whole = Math.floor(total / 10);
    tenths = total % 10;
  } else {
    whole = Math.floor(s0 + 1e-6);
  }
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const base = h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return fraction ? `${base}.${tenths}` : base;
}

/** Compact "12,4 с" / "1:05" style duration for badges */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return t("units.seconds", { n: (Math.round(seconds * 10) / 10).toString().replace(".", ",") });
  return formatTimecode(seconds);
}
