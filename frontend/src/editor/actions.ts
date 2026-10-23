import { toast } from "@/components/ios";
import { t } from "@/i18n";
import { bannerBox, frameSize } from "@/lib/geometry";
import { uid } from "@/lib/id";
import { outputDuration, outputToSource } from "@/lib/timeline";
import type { Aspect, Asset, Banner } from "@/lib/types";
import { useAssets } from "@/store/assets";
import { useEditor } from "@/store/editor";
import { usePlayer } from "./playback";

export function splitAtPlayhead() {
  const st = useEditor.getState();
  const doc = st.doc!;
  const time = usePlayer.getState().time;
  const { index, source } = outputToSource(doc.cuts, time);
  const c = doc.cuts[index];
  if (!c || source - c.start < 0.2 || c.end - source < 0.2) {
    toast({ title: t("trim.splitTooClose"), tone: "info" });
    return;
  }
  const newId = uid(8);
  st.update((d) => {
    const cut = d.cuts[index];
    const right = { id: newId, start: Math.round(source * 1000) / 1000, end: cut.end };
    cut.end = right.start;
    d.cuts.splice(index + 1, 0, right);
  });
  st.select({ kind: "cut", id: newId });
}

export function deleteSelectedCut() {
  const st = useEditor.getState();
  const sel = st.selection;
  if (sel?.kind !== "cut") {
    toast({ title: t("trim.selectClip"), tone: "info" });
    return;
  }
  if (st.doc!.cuts.length <= 1) {
    toast({ title: t("trim.lastClip"), tone: "info" });
    return;
  }
  st.update((d) => {
    d.cuts = d.cuts.filter((c) => c.id !== sel.id);
    const total = outputDuration(d.cuts);
    for (const b of d.banners) {
      if (b.start >= total) b.start = Math.max(0, total - 1);
      b.end = Math.min(Math.max(b.start + 0.2, b.end), total);
    }
  });
  st.select(null);
}

export function restoreCuts() {
  const st = useEditor.getState();
  const duration = st.meta!.media!.duration;
  st.update((d) => {
    d.cuts = [{ id: uid(8), start: 0, end: Math.round(duration * 1000) / 1000 }];
  });
  st.select(null);
}

/** Change the frame aspect, keeping banner proportions in pixels. */
export function setAspect(aspect: Aspect) {
  const st = useEditor.getState();
  const before = frameSize(st.doc!.aspect);
  const after = frameSize(aspect);
  st.update((d) => {
    d.aspect = aspect;
    for (const b of d.banners) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const pxAspect = (b.w * before.width) / (b.h * before.height);
      b.h = (b.w * after.width) / pxAspect / after.height;
      if (b.h > 1.2) {
        b.h = 1.2;
        b.w = (b.h * after.height * pxAspect) / after.width;
      }
      b.x = cx - b.w / 2;
      b.y = cy - b.h / 2;
    }
  });
}

export function addBanner(asset: Asset): string {
  const st = useEditor.getState();
  const doc = st.doc!;
  const { width: W, height: H } = frameSize(doc.aspect);
  const total = outputDuration(doc.cuts);
  const start = Math.min(usePlayer.getState().time, Math.max(0, total - 0.5));
  const len = asset.kind === "video" && asset.duration ? Math.min(asset.duration, 15) : 5;
  const box = bannerBox(asset.width / Math.max(1, asset.height), W, H, 0.6);
  const id = uid(8);
  const banner: Banner = {
    id,
    assetId: asset.id,
    ...box,
    rotation: 0,
    opacity: 1,
    start: Math.round(start * 1000) / 1000,
    end: Math.round(Math.min(total, start + len) * 1000) / 1000,
    animIn: "fade",
    animOut: "fade",
    animDuration: 0.4,
    chroma: null,
  };
  if (banner.end - banner.start < 0.2) banner.end = Math.min(total, banner.start + 0.5);
  st.update((d) => {
    d.banners.push(banner);
  });
  st.select({ kind: "banner", id });
  return id;
}

export function assetFor(assetId: string): Asset | undefined {
  return useAssets.getState().assets.find((a) => a.id === assetId);
}
