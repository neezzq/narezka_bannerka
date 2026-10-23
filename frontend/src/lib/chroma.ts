// Key colour helpers. Chroma keying compares only U/V, so a grey key colour
// (black, white, any grey) matches every unsaturated pixel of the frame.

/** Distance from grey in U/V units (full-range BT.601): 0 for black, white and greys. */
export function chromaOf(r: number, g: number, b: number): number {
  const u = -0.168736 * r - 0.331264 * g + 0.5 * b;
  const v = 0.5 * r - 0.418688 * g - 0.081312 * b;
  return Math.hypot(u, v);
}

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

export function toHex(r: number, g: number, b: number): string {
  const x = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${x(r)}${x(g)}${x(b)}`.toUpperCase();
}

/** Below this a key colour removes greys/skin/shadows instead of a backdrop. */
export const NEUTRAL_CHROMA = 24;
const MIN_KEY_CHROMA = 30;
const HUE_BINS = 24;

export const isNeutralKey = (hex: string) => chromaOf(...parseHex(hex)) < NEUTRAL_CHROMA;

/**
 * The backdrop colour of a keyed source: the most common saturated hue along
 * the frame border (RGBA pixels, row-major). Null when the border has no
 * dominant saturated colour (no green/blue screen).
 */
export function detectKeyColor(px: Uint8ClampedArray, w: number, h: number, band = 3): string | null {
  const count = new Array<number>(HUE_BINS).fill(0);
  const sum = Array.from({ length: HUE_BINS }, () => [0, 0, 0]);
  let opaque = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 4;
      if (px[i + 3] < 200) continue; // transparent: nothing to key
      opaque++;
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      if (chromaOf(r, g, b) < MIN_KEY_CHROMA) continue;
      const u = -0.168736 * r - 0.331264 * g + 0.5 * b;
      const v = 0.5 * r - 0.418688 * g - 0.081312 * b;
      const bin = Math.floor(((Math.atan2(v, u) + Math.PI) / (2 * Math.PI)) * HUE_BINS) % HUE_BINS;
      count[bin]++;
      sum[bin][0] += r;
      sum[bin][1] += g;
      sum[bin][2] += b;
    }
  }
  if (!opaque) return null;
  let best = -1;
  let bestScore = 0;
  for (let k = 0; k < HUE_BINS; k++) {
    const score = count[(k + HUE_BINS - 1) % HUE_BINS] + count[k] + count[(k + 1) % HUE_BINS];
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (best < 0 || bestScore < opaque * 0.3) return null;
  const rgb = [0, 0, 0];
  for (const k of [best - 1, best, best + 1].map((j) => (j + HUE_BINS) % HUE_BINS)) {
    for (let c = 0; c < 3; c++) rgb[c] += sum[k][c];
  }
  return toHex(rgb[0] / bestScore, rgb[1] / bestScore, rgb[2] / bestScore);
}
