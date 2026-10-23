// Reading colours from preview elements. iOS often has no decoded frame for a
// video that has not played yet: drawImage then yields transparent pixels, so
// every read checks for that and falls back to the server-made thumbnail.
import { detectKeyColor, toHex } from "@/lib/chroma";
import type { ChromaSource } from "./shader";

type Source = ChromaSource | HTMLImageElement;

function sizeOf(src: Source): [number, number] {
  if (src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  return [src.width, src.height];
}

/** RGBA pixels of a region of `src`, or null when nothing is drawable. */
function read(src: Source, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number) {
  const c = document.createElement("canvas");
  c.width = dw;
  c.height = dh;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
    const px = ctx.getImageData(0, 0, dw, dh).data;
    for (let i = 3; i < px.length; i += 4) if (px[i]) return px;
    return null; // fully transparent: no frame yet (or a transparent area)
  } catch {
    return null;
  }
}

/** Average colour of a 5×5 patch at normalised coords, ignoring transparency. */
function sampleAt(src: Source, u: number, v: number): string | null {
  const [w, h] = sizeOf(src);
  if (!w || !h || u < 0 || u > 1 || v < 0 || v > 1) return null;
  const n = Math.min(5, w, h);
  const sx = Math.min(w - n, Math.max(0, Math.round(u * w) - 2));
  const sy = Math.min(h - n, Math.max(0, Math.round(v * h) - 2));
  const px = read(src, sx, sy, n, n, n, n);
  if (!px) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i < px.length; i += 4) {
    const k = px[i + 3] / 255;
    r += px[i] * k;
    g += px[i + 1] * k;
    b += px[i + 2] * k;
    a += k;
  }
  if (a < (px.length / 4) * 0.5) return null;
  return toHex(r / a, g / a, b / a);
}

function detect(src: Source): string | null {
  const [w, h] = sizeOf(src);
  if (!w || !h) return null;
  const k = 64 / Math.max(w, h);
  const dw = Math.max(8, Math.round(w * k));
  const dh = Math.max(8, Math.round(h * k));
  const px = read(src, 0, 0, w, h, dw, dh);
  return px ? detectKeyColor(px, dw, dh) : null;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = url;
    });
    images.set(url, p);
  }
  return p;
}

/** Give a muted video that never played a chance to decode a frame. */
async function ensureFrame(src: Source | null) {
  if (!(src instanceof HTMLVideoElement) || src.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      src.removeEventListener("loadeddata", done);
      resolve();
    };
    const timer = setTimeout(done, 1200);
    src.addEventListener("loadeddata", done);
    if (src.muted && src.paused) {
      src
        .play()
        .then(() => src.pause())
        .catch(() => undefined);
    }
  });
}

/** Colour under the eyedropper: the live element first, then the thumbnail. */
export async function pickColor(src: Source | null, u: number, v: number, fallbackUrl?: string | null) {
  await ensureFrame(src);
  const live = src ? sampleAt(src, u, v) : null;
  if (live || !fallbackUrl) return live;
  const im = await loadImage(fallbackUrl);
  return im ? sampleAt(im, u, v) : null;
}

/** Backdrop colour from the frame border: the live element first, then the thumbnail. */
export async function autoKeyColor(src: Source | null, fallbackUrl?: string | null) {
  await ensureFrame(src);
  const live = src ? detect(src) : null;
  if (live || !fallbackUrl) return live;
  const im = await loadImage(fallbackUrl);
  return im ? detect(im) : null;
}
