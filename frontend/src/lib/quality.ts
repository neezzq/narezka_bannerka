// Quality classes ("1080p"), mirroring backend/app/services/quality.py.

const LADDER = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
const LONG: [number, number][] = [
  [256, 144], [426, 240], [640, 360], [854, 480], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [7680, 4320],
];
/** Lower qualities are not worth offering for editing. */
const MIN_OFFERED = 360;

/** 1920×1080, 1080×1920 and 1920×804 → 1080; 0 when unknown. */
export function qualityClass(width: number, height: number): number {
  if (!width || !height) return 0;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const byShort = Math.max(0, ...LADDER.filter((q) => q <= short * 1.05));
  const byLong = Math.max(0, ...LONG.filter(([side]) => side <= long * 1.05).map(([, q]) => q));
  return Math.max(byShort, byLong);
}

export const qualityLabel = (q: number) => (q === 4320 ? "8K" : q === 2160 ? "4K" : `${q}p`);

/** Download options: the source's qualities (or the ladder up to a file's own), best first. */
export function downloadQualities(available: number[] | undefined, width: number, height: number, max: number): number[] {
  const own = qualityClass(width, height);
  const list = available?.length ? available : LADDER.filter((q) => q <= own).reverse();
  const offered = list.filter((q) => q <= max && q >= MIN_OFFERED);
  return offered.length ? offered : list.slice(0, 1);
}

/** The best option not above `preferred`, else the lowest one. */
export function pickQuality(options: number[], preferred: number): number | null {
  if (!options.length) return null;
  return options.find((q) => q <= preferred) ?? options[options.length - 1];
}

export type ExportQuality = "720p" | "1080p" | "1440p" | "2160p";
export const EXPORT_SHORT_SIDE: Record<ExportQuality, number> = { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 };

/** Export options: 720p and 1080p always, higher ones when the source has them. */
export function exportQualities(width: number, height: number): ExportQuality[] {
  const own = qualityClass(width, height);
  return (Object.keys(EXPORT_SHORT_SIDE) as ExportQuality[]).filter((q) => EXPORT_SHORT_SIDE[q] <= Math.max(1080, own));
}
