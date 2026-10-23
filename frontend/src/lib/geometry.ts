// Frame geometry — mirrors backend/app/render/graph.py and schemas.frame_size.
import type { Anim, Aspect, Banner, ProjectDoc } from "./types";

export const REFERENCE_SHORT_SIDE = 1080;
const RATIOS: Record<Aspect, [number, number]> = { "9:16": [9, 16], "16:9": [16, 9], "1:1": [1, 1], "4:5": [4, 5] };

export function frameSize(aspect: Aspect, short = REFERENCE_SHORT_SIDE): { width: number; height: number } {
  const [aw, ah] = RATIOS[aspect];
  let w: number;
  let h: number;
  if (aw <= ah) {
    w = short;
    h = Math.round((short * ah) / aw);
  } else {
    h = short;
    w = Math.round((short * aw) / ah);
  }
  return { width: w + (w % 2), height: h + (h % 2) };
}

export interface Placement {
  scale: number;
  x0: number;
  y0: number;
  sw: number;
  sh: number;
}

export function videoPlacement(
  doc: Pick<ProjectDoc, "videoTransform">,
  media: { width: number; height: number },
  W: number,
  H: number,
): Placement {
  const t = doc.videoTransform;
  const base = (t.fit === "contain" ? Math.min : Math.max)(W / media.width, H / media.height);
  const s = base * t.scale;
  const sw = media.width * s;
  const sh = media.height * s;
  const cx = W / 2 + t.x * W;
  const cy = H / 2 + t.y * H;
  return { scale: s, x0: cx - sw / 2, y0: cy - sh / 2, sw, sh };
}

const easeOut = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);

/** Animated state of a banner at output time t (same maths as the ffmpeg expressions). */
export function bannerState(b: Banner, t: number, W: number, H: number) {
  const visible = t >= b.start && t <= b.end;
  let alpha = b.opacity;
  let k = 1;
  let dx = 0;
  let dy = 0;
  const d = b.animDuration;
  const offsets: Record<string, [number, number]> = {
    "slide-left": [-(b.x + b.w) * W, 0],
    "slide-right": [(1 - b.x) * W, 0],
    "slide-up": [0, (1 - b.y) * H],
    "slide-down": [0, -(b.y + b.h) * H],
  };
  const phases: [Anim, number][] = [
    [b.animIn, (t - b.start) / d],
    [b.animOut, (b.end - t) / d],
  ];
  for (const [kind, u] of phases) {
    if (kind === "fade" || kind === "scale") alpha *= Math.min(1, Math.max(0, u));
    if (kind === "scale") k *= easeOut(u);
    const off = offsets[kind];
    if (off) {
      const f = 1 - easeOut(u);
      dx += off[0] * f;
      dy += off[1] * f;
    }
  }
  return { visible, alpha, scale: k, dx, dy };
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Fit a banner of pixel aspect `ar` into the frame with width fraction `wf`, centred. */
export function bannerBox(ar: number, W: number, H: number, wf = 0.6): Pick<Banner, "x" | "y" | "w" | "h"> {
  let w = wf;
  let h = (w * W) / ar / H;
  if (h > 0.9) {
    h = 0.9;
    w = (h * H * ar) / W;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export type BannerPreset = "tl" | "tr" | "bl" | "br" | "center" | "lower" | "full";

export function bannerPreset(
  preset: BannerPreset,
  b: Pick<Banner, "w" | "h">,
  ar: number,
  W: number,
  H: number,
): Pick<Banner, "x" | "y" | "w" | "h" | "rotation"> {
  const m = 0.04;
  const my = (m * W) / H;
  let { w, h } = b;
  if (preset === "lower") {
    w = 1;
    h = W / ar / H;
    return { x: 0, y: 1 - h - 0.1, w, h, rotation: 0 };
  }
  if (preset === "full") {
    const fw = Math.min(1, (H * ar) / W);
    const fh = (fw * W) / ar / H;
    return { x: (1 - fw) / 2, y: (1 - fh) / 2, w: fw, h: fh, rotation: 0 };
  }
  if (w > 0.6) {
    w = 0.4;
    h = (w * W) / ar / H;
  }
  const pos: Record<string, [number, number]> = {
    tl: [m, my + 0.03],
    tr: [1 - m - w, my + 0.03],
    bl: [m, 1 - my - h - 0.12],
    br: [1 - m - w, 1 - my - h - 0.12],
    center: [(1 - w) / 2, (1 - h) / 2],
  };
  const [x, y] = pos[preset];
  return { x, y, w, h, rotation: 0 };
}
