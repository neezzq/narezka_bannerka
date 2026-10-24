// Text banners: a banner whose image is drawn from `banner.text` in the browser.
// A new image shows at once from a blob URL; it uploads in the background and the
// local asset id is then swapped for the server one everywhere (history included).
import { toast } from "@/components/ios";
import { t } from "@/i18n";
import { clamp, frameSize } from "@/lib/geometry";
import { uid } from "@/lib/id";
import { outputDuration } from "@/lib/timeline";
import type { Asset, Banner, TextSpec } from "@/lib/types";
import { TEXT_ASSET_NAME, useAssets } from "@/store/assets";
import { useEditor } from "@/store/editor";
import { usePlayer } from "../playback";
import { DEFAULT_TEXT, renderText } from "./renderText";

const pending = new Set<Promise<unknown>>();

/** Resolves when every text image has reached the server (before an export). */
export function waitTextUploads(): Promise<unknown> {
  return Promise.all([...pending]);
}

/** Font size of a text banner in the 1080-short-side reference frame. */
export function textFontSize(b: Banner, H: number): number {
  return b.text ? (b.text.renderFont * b.h * H) / b.text.renderHeight : 0;
}

/** Font px to draw with: twice the reference size keeps 2160p exports crisp. */
const drawSize = (fontRef: number) => clamp(Math.round(fontRef * 2), 64, 480);

async function makeImage(spec: TextSpec, fontRef: number) {
  const r = await renderText(spec, drawSize(fontRef));
  const url = URL.createObjectURL(r.blob);
  const local: Asset = {
    id: `local-${uid(10)}`,
    kind: "image",
    status: "ready",
    error: null,
    name: TEXT_ASSET_NAME,
    width: r.width,
    height: r.height,
    duration: null,
    url,
    thumbUrl: url,
    gif: null,
    createdAt: new Date().toISOString(),
  };
  const assets = useAssets.getState();
  assets.addLocal(local);
  const upload = assets
    .uploadQuiet(new File([r.blob], TEXT_ASSET_NAME, { type: "image/png" }))
    .then((real) => {
      useEditor.getState().remapAsset(local.id, real.id);
      // keep showing the blob already decoded in this tab: no flash on the swap
      useAssets.setState((s) => ({
        assets: s.assets.filter((a) => a.id !== local.id).map((a) => (a.id === real.id ? { ...a, url, thumbUrl: url } : a)),
      }));
    })
    .catch((e: Error) => toast({ title: t("text.uploadFailed"), message: e.message, tone: "error" }))
    .finally(() => pending.delete(upload));
  pending.add(upload);
  return { asset: local, r };
}

export async function addTextBanner(content: string): Promise<string> {
  const st = useEditor.getState();
  const doc = st.doc!;
  const { width: W, height: H } = frameSize(doc.aspect);
  const fontRef = Math.round(0.075 * Math.min(W, H));
  const spec: TextSpec = { ...DEFAULT_TEXT, content };
  const { asset, r } = await makeImage(spec, fontRef);
  const k = fontRef / r.font;
  const w = (r.width * k) / W;
  const h = (r.height * k) / H;
  const total = outputDuration(doc.cuts);
  const start = Math.min(usePlayer.getState().time, Math.max(0, total - 0.5));
  const id = uid(8);
  const banner: Banner = {
    id,
    assetId: asset.id,
    x: 0.5 - w / 2,
    y: 0.5 - h / 2,
    w,
    h,
    rotation: 0,
    opacity: 1,
    start: Math.round(start * 1000) / 1000,
    end: Math.round(Math.min(total, start + 4) * 1000) / 1000,
    // visible right under the playhead; an entrance can be added in the panel
    animIn: "none",
    animOut: "none",
    animDuration: 0.3,
    chroma: null,
    text: { ...spec, renderFont: r.font, renderHeight: r.height },
  };
  if (banner.end - banner.start < 0.2) banner.end = Math.min(total, banner.start + 0.5);
  useEditor.getState().update((d) => void d.banners.push(banner));
  useEditor.getState().select({ kind: "banner", id });
  return id;
}

const latest = new Map<string, number>();

/** Redraw a text banner with `patch` applied, keeping its centre, size and rotation. */
export async function restyleText(id: string, patch: Partial<TextSpec>, fontRef?: number) {
  const before = useEditor.getState().doc?.banners.find((b) => b.id === id);
  if (!before?.text) return;
  const token = (latest.get(id) ?? 0) + 1;
  latest.set(id, token);
  const { height: H } = frameSize(useEditor.getState().doc!.aspect);
  const size = fontRef ?? textFontSize(before, H);
  const spec = { ...before.text, ...patch };
  const { asset, r } = await makeImage(spec, size);
  if (latest.get(id) !== token) return; // a newer edit is on its way
  const st = useEditor.getState();
  const { width: W } = frameSize(st.doc!.aspect);
  st.update((d) => {
    const b = d.banners.find((x) => x.id === id);
    if (!b) return;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const k = size / r.font;
    b.w = (r.width * k) / W;
    b.h = (r.height * k) / H;
    b.x = cx - b.w / 2;
    b.y = cy - b.h / 2;
    b.assetId = asset.id;
    b.text = { ...spec, renderFont: r.font, renderHeight: r.height };
  });
}

/** Scale a text banner around its centre to a new font size (no redraw). */
export function resizeText(id: string, fontRef: number) {
  const st = useEditor.getState();
  const { height: H } = frameSize(st.doc!.aspect);
  st.update((d) => {
    const b = d.banners.find((x) => x.id === id);
    if (!b?.text) return;
    const k = fontRef / textFontSize(b as Banner, H);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    b.w *= k;
    b.h *= k;
    b.x = cx - b.w / 2;
    b.y = cy - b.h / 2;
  });
}

// Enlarged far beyond its pixels (handles, pinch, wheel, slider): redraw it sharper.
let sharpenTimer: number | undefined;
useEditor.subscribe((s, prev) => {
  if (!s.doc || s.doc === prev.doc || s.gestureBase) return;
  clearTimeout(sharpenTimer);
  sharpenTimer = window.setTimeout(() => {
    const st = useEditor.getState();
    if (!st.doc || st.gestureBase) return;
    const { height: H } = frameSize(st.doc.aspect);
    for (const b of st.doc.banners) {
      if (b.text && drawSize(textFontSize(b, H)) > b.text.renderFont * 1.3) void restyleText(b.id, {});
    }
  }, 500);
});
