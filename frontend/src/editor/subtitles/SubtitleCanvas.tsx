import { useEffect, useMemo, useRef, useState } from "react";
import { t as tr } from "@/i18n";
import { catalogSync, ensureFont, loadCatalog, resolveFace, type FontFamily } from "@/lib/fonts";
import { buildPages, pageAt } from "@/lib/timeline";
import { useEditor } from "@/store/editor";
import { usePlayer } from "../playback";
import { drawSubtitles, type SubBox } from "./renderSubtitles";

/** Last drawn subtitle box (reference px) for hit testing / dragging. */
export const subtitleHit: { box: SubBox | null } = { box: null };

export function useFontCatalog(): FontFamily[] {
  const [cat, setCat] = useState<FontFamily[]>(() => catalogSync() ?? []);
  useEffect(() => {
    if (!cat.length) loadCatalog().then(setCat);
  }, [cat.length]);
  return cat;
}

export function SubtitleCanvas({ W, H, scale }: { W: number; H: number; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const subs = useEditor((s) => s.doc!.subtitles);
  const cuts = useEditor((s) => s.doc!.cuts);
  const tool = useEditor((s) => s.tool);
  const catalog = useFontCatalog();
  const [fontTick, setFontTick] = useState(0);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const k = scale * dpr;
  const style = subs.style;
  const face = useMemo(() => (catalog.length ? resolveFace(catalog, style.fontFamily, style.fontWeight) : null), [catalog, style.fontFamily, style.fontWeight]);
  const pages = useMemo(
    () => buildPages(subs.lines, cuts, { wordsPerScreen: style.wordsPerScreen, uppercase: style.uppercase }),
    [subs.lines, cuts, style.wordsPerScreen, style.uppercase],
  );

  useEffect(() => {
    if (face) ensureFont(face).then(() => setFontTick((x) => x + 1));
  }, [face]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !face) return;
    const draw = (time: number) => {
      const ctx = c.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      if (!subs.enabled && tool !== "subtitles") {
        subtitleHit.box = null;
        return;
      }
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const page = subs.enabled ? pageAt(pages, time) : null;
      subtitleHit.box = drawSubtitles(ctx, scratch.current, {
        page,
        style,
        face,
        frameW: W,
        frameH: H,
        t: time,
        k,
        ghost: tool === "subtitles" ? tr("subs.sample") : undefined,
      });
    };
    draw(usePlayer.getState().time);
    return usePlayer.subscribe((s, prev) => {
      if (s.time !== prev.time) draw(s.time);
    });
  }, [pages, style, face, W, H, k, subs.enabled, tool, fontTick]);

  return (
    <canvas
      ref={canvas}
      width={Math.round(W * k)}
      height={Math.round(H * k)}
      className="pointer-events-none absolute inset-0"
      style={{ width: W * scale, height: H * scale }}
      aria-hidden
    />
  );
}
