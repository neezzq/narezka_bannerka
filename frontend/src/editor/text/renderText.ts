// Draws a text banner into a PNG with the app's own font files. The export uses
// this very image, so what the preview shows is what the video gets.
import { catalogSync, ensureFont, loadCatalog, resolveFace } from "@/lib/fonts";
import type { TextSpec } from "@/lib/types";

export const DEFAULT_TEXT: TextSpec = {
  content: "",
  preset: "classic",
  font: "montserrat",
  weight: 900,
  color: "#FFFFFF",
  align: "center",
  outline: 0.08,
  outlineColor: "#000000",
  shadow: false,
  box: false,
  boxColor: "#000000",
  boxOpacity: 0.6,
  uppercase: false,
  renderFont: 160,
  renderHeight: 200,
};

export const TEXT_PRESETS: { id: string; spec: Partial<TextSpec> }[] = [
  { id: "classic", spec: { color: "#FFFFFF", outline: 0.08, outlineColor: "#000000", shadow: false, box: false, weight: 900 } },
  { id: "plate", spec: { color: "#121214", outline: 0, shadow: false, box: true, boxColor: "#FFFFFF", boxOpacity: 1, weight: 900 } },
  { id: "dark", spec: { color: "#FFFFFF", outline: 0, shadow: false, box: true, boxColor: "#000000", boxOpacity: 0.6, weight: 700 } },
  { id: "yellow", spec: { color: "#FFE600", outline: 0.1, outlineColor: "#000000", shadow: false, box: false, weight: 900 } },
  { id: "accent", spec: { color: "#A6E22E", outline: 0.08, outlineColor: "#121214", shadow: false, box: false, weight: 900 } },
  { id: "soft", spec: { color: "#FFFFFF", outline: 0, shadow: true, box: false, weight: 700 } },
];

export interface RenderedText {
  blob: Blob;
  width: number;
  height: number;
  /** font px the text was drawn with */
  font: number;
}

const MAX_SIDE = 4096;

function layout(ctx: CanvasRenderingContext2D, lines: string[], spec: TextSpec, F: number, asc: number, desc: number) {
  const widths = lines.map((l) => ctx.measureText(l || " ").width);
  const lineH = Math.round(F * 1.2);
  const stroke = spec.outline * F;
  const padX = spec.box ? 0.4 * F : 0;
  const padY = spec.box ? 0.18 * F : 0;
  const margin = Math.ceil(stroke + (spec.shadow ? 0.3 * F : 0) + 2);
  const width = Math.ceil(Math.max(...widths) + 2 * (padX + margin));
  const height = Math.ceil(lineH * lines.length + 2 * (padY + margin));
  return { widths, lineH, stroke, padX, padY, margin, width, height, asc, desc };
}

export async function renderText(spec: TextSpec, fontPx: number): Promise<RenderedText> {
  const catalog = catalogSync() ?? (await loadCatalog());
  const face = catalog.length ? resolveFace(catalog, spec.font, spec.weight) : null;
  if (face) await ensureFont(face);
  const family = face ? `"${face.internalName}"` : "sans-serif";
  const asc = face ? face.ascent / face.unitsPerEm : 0.9;
  const desc = face ? face.descent / face.unitsPerEm : 0.25;
  const lines = ((spec.uppercase ? spec.content.toUpperCase() : spec.content) || " ").split("\n");

  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  let F = Math.round(fontPx);
  ctx.font = `${F}px ${family}`;
  let L = layout(ctx, lines, spec, F, asc, desc);
  if (L.width > MAX_SIDE || L.height > MAX_SIDE) {
    // a very long line: draw smaller instead of exceeding the canvas limits
    F = Math.floor(F * Math.min(MAX_SIDE / L.width, MAX_SIDE / L.height) * 0.98);
    ctx.font = `${F}px ${family}`;
    L = layout(ctx, lines, spec, F, asc, desc);
  }
  c.width = L.width;
  c.height = L.height;
  ctx.font = `${F}px ${family}`; // resizing the canvas resets the context
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  const shadow = (on: boolean) => {
    ctx.shadowColor = on ? "rgba(0,0,0,0.55)" : "transparent";
    ctx.shadowBlur = on ? 0.12 * F : 0;
    ctx.shadowOffsetY = on ? 0.05 * F : 0;
  };
  if (spec.box) {
    ctx.globalAlpha = spec.boxOpacity;
    ctx.fillStyle = spec.boxColor;
    shadow(spec.shadow);
    ctx.beginPath();
    ctx.roundRect(L.margin, L.margin, L.width - 2 * L.margin, L.height - 2 * L.margin, 0.22 * F);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // glyphs centred in their line box using the font's own ascent/descent
  const baseline0 = L.margin + L.padY + (L.lineH - (asc + desc) * F) / 2 + asc * F;
  const xOf = (w: number) =>
    spec.align === "left" ? L.margin + L.padX : spec.align === "right" ? L.width - L.margin - L.padX - w : (L.width - w) / 2;
  shadow(spec.shadow && !spec.box);
  if (L.stroke > 0.5) {
    ctx.lineWidth = 2 * L.stroke;
    ctx.strokeStyle = spec.outlineColor;
    lines.forEach((line, i) => ctx.strokeText(line, xOf(L.widths[i]), baseline0 + i * L.lineH));
    shadow(false);
  }
  ctx.fillStyle = spec.color;
  lines.forEach((line, i) => ctx.fillText(line, xOf(L.widths[i]), baseline0 + i * L.lineH));

  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
  return { blob, width: L.width, height: L.height, font: F };
}
