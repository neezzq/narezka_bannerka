// Canvas preview of subtitles — mirrors backend/app/render/ass.py so the burned-in
// result matches: same font files, em size, outline (stroke 2×, round joins, under
// the fill), hard shadow (union of fill+outline shifted), centred line box with
// libass metrics (line height = em·(winAscent+winDescent)/upm, baseline at winAscent).
// Like libass, \fscx/\fscy (pop animation, auto-fit) scale glyphs and the box
// drawing but NOT the outline width or the shadow offset.
import type { FontWeight } from "@/lib/fonts";
import { activeWord, fitScale, lineAnimState, type Page, wordScale } from "@/lib/timeline";
import type { SubtitleStyle } from "@/lib/types";

export interface SubBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

const font = (face: FontWeight, em: number) => `${em}px "${face.internalName}"`;

/**
 * Draw the subtitle page visible at time `t`.
 * `ctx` must already be transformed so that 1 unit = 1 px of the reference frame;
 * `k` is that scale in device pixels (for the shadow layer).
 * Returns the line box in reference px (for hit testing), or null.
 */
export function drawSubtitles(
  ctx: CanvasRenderingContext2D,
  scratch: HTMLCanvasElement,
  opts: {
    page: Page | null;
    style: SubtitleStyle;
    face: FontWeight;
    frameW: number;
    frameH: number;
    t: number;
    k: number;
    ghost?: string;
  },
): SubBox | null {
  const { style, face, frameW, frameH, t, k } = opts;
  let page = opts.page;
  let ghostAlpha = 1;
  if (!page && opts.ghost) {
    const words = opts.ghost.split(" ").map((text) => ({ text: style.uppercase ? text.toUpperCase() : text, start: t - 10, end: t + 10 }));
    page = { words, start: t - 10, end: t + 10, lineId: "ghost", text: words.map((w) => w.text).join(" ") };
    ghostAlpha = 0.45;
  }
  if (!page || !page.words.length) return null;

  const base = style.fontSize;
  const upm = face.unitsPerEm;
  const anim = lineAnimState(style, page.start, t);
  ctx.font = font(face, base);
  const fullW = ctx.measureText(page.text).width;
  const fit = fitScale(fullW, style, frameW);
  const lineScale = anim.scale * fit;
  const active = style.karaoke || style.wordPop ? activeWord(page, t) : -1;

  // ---- layout (unscaled line, origin at the anchor)
  const ems = page.words.map((w, i) => (i === active ? base * wordScale(style, w.start, t) : base));
  ctx.font = font(face, base);
  const space = ctx.measureText(" ").width;
  const widths = page.words.map((w, i) => {
    ctx.font = font(face, ems[i]);
    return ctx.measureText(w.text).width;
  });
  const total = widths.reduce((a, b) => a + b, 0) + space * (page.words.length - 1);
  const maxEm = Math.max(...ems);
  const lineH = (maxEm * (face.ascent + face.descent)) / upm;
  const baseline = -lineH / 2 + (maxEm * face.ascent) / upm;
  const cx = style.position.x * frameW;
  const cy = style.position.y * frameH + anim.dy;
  const alpha = anim.alpha * ghostAlpha;
  if (alpha <= 0.001) return { x: cx - total / 2, y: cy - lineH / 2, w: total, h: lineH };

  const xs: number[] = [];
  let x = -total / 2;
  for (const w of widths) {
    xs.push(x);
    x += w + space;
  }

  const paintText = (c: CanvasRenderingContext2D, fillFor: (i: number) => string, strokeColor: string) => {
    c.lineJoin = "round";
    c.miterLimit = 2;
    c.textBaseline = "alphabetic";
    if (style.outlineWidth > 0) {
      c.lineWidth = (style.outlineWidth * 2) / lineScale;
      c.strokeStyle = strokeColor;
      page!.words.forEach((w, i) => {
        c.font = font(face, ems[i]);
        c.strokeText(w.text, xs[i], baseline);
      });
    }
    page!.words.forEach((w, i) => {
      c.font = font(face, ems[i]);
      c.fillStyle = fillFor(i);
      c.fillText(w.text, xs[i], baseline);
    });
  };

  const applyLineTransform = (c: CanvasRenderingContext2D) => {
    c.translate(cx, cy);
    c.scale(lineScale, lineScale);
  };

  ctx.save();
  // box (layer 0 in ASS)
  if (style.box.enabled) {
    ctx.save();
    applyLineTransform(ctx);
    const bw = fullW + 2 * style.box.paddingX;
    const bh = (base * (face.ascent + face.descent)) / upm + 2 * style.box.paddingY;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hexA(style.box.color, style.box.opacity);
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, style.box.radius);
    ctx.fill();
    ctx.restore();
  }

  // hard shadow: union of fill + outline in one colour, then composited with its opacity
  if (style.shadowOpacity > 0.001 && style.shadowOffset > 0) {
    if (scratch.width !== ctx.canvas.width || scratch.height !== ctx.canvas.height) {
      scratch.width = ctx.canvas.width;
      scratch.height = ctx.canvas.height;
    }
    const sc = scratch.getContext("2d")!;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, scratch.width, scratch.height);
    sc.setTransform(ctx.getTransform());
    applyLineTransform(sc);
    paintText(sc, () => style.shadowColor, style.shadowColor);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha * style.shadowOpacity;
    const off = style.shadowOffset * k;
    ctx.drawImage(scratch, off, off);
    ctx.restore();
  }

  ctx.globalAlpha = alpha;
  applyLineTransform(ctx);
  paintText(ctx, (i) => (style.karaoke && i === active ? style.highlightColor : style.color), style.outlineColor);
  ctx.restore();

  const s = lineScale;
  return { x: cx - (total / 2) * s, y: cy - (lineH / 2) * s, w: total * s, h: lineH * s };
}
