import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ios";
import { t } from "@/i18n";
import { bannerState, clamp, frameSize, videoPlacement } from "@/lib/geometry";
import type { Banner, ChromaSettings } from "@/lib/types";
import { useEditor } from "@/store/editor";
import { BannerLayer, bannerSources } from "./banners/BannerLayer";
import { ChromaCanvas, sampleColor } from "./chroma/ChromaCanvas";
import { playback, usePlayer } from "./playback";
import { SubtitleCanvas, subtitleHit } from "./subtitles/SubtitleCanvas";

const DEG = 180 / Math.PI;

function useSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function Preview({ bottomInset = 0 }: { bottomInset?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { w, h } = useSize(container);
  const media = useEditor((s) => s.meta!.media!);
  const aspect = useEditor((s) => s.doc!.aspect);
  const transform = useEditor((s) => s.doc!.videoTransform);
  const background = useEditor((s) => s.doc!.background);
  const banners = useEditor((s) => s.doc!.banners);
  const videoChroma = useEditor((s) => s.doc!.videoChroma);
  const cuts = useEditor((s) => s.doc!.cuts);
  const { width: W, height: H } = frameSize(aspect);
  const availH = Math.max(0, h - bottomInset - 16);
  const scale = w && availH ? Math.min((w - 16) / W, availH / H) : 0;
  const place = videoPlacement({ videoTransform: transform }, media, W, H);
  const keyed = !!videoChroma?.enabled;
  const getVideo = useCallback(() => video.current, []);

  useEffect(() => {
    playback.attach(video.current);
    return () => playback.attach(null);
  }, []);
  useEffect(() => {
    playback.setCuts(cuts);
  }, [cuts]);

  const dpr = window.devicePixelRatio || 1;
  return (
    <div ref={container} className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden pt-2" style={{ paddingBottom: bottomInset }}>
      <div
        data-testid="stage"
        className="relative overflow-hidden rounded-[4px] shadow-[0_0_0_0.5px_var(--color-separator)]"
        style={{ width: W * scale, height: H * scale, background, marginTop: Math.max(0, (availH - H * scale) / 2) }}
      >
        <div className="absolute top-0 left-0" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <video
            ref={video}
            src={media.proxyUrl}
            playsInline
            preload="auto"
            className="absolute max-w-none"
            style={{ left: place.x0, top: place.y0, width: place.sw, height: place.sh, objectFit: "fill", opacity: keyed ? 0 : 1 }}
          />
          {keyed && videoChroma && (
            <ChromaCanvas
              getSource={getVideo}
              settings={videoChroma}
              pixelWidth={Math.min(media.width, place.sw * scale * dpr)}
              pixelHeight={Math.min(media.height, place.sh * scale * dpr)}
              className="absolute max-w-none"
              style={{ left: place.x0, top: place.y0, width: place.sw, height: place.sh }}
            />
          )}
          <BannerLayer banners={banners} W={W} H={H} displayScale={scale} />
        </div>
        {scale > 0 && <SubtitleCanvas W={W} H={H} scale={scale} />}
        {scale > 0 && <Gestures W={W} H={H} s={scale} getVideo={getVideo} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ gestures

type Target =
  | { kind: "banner"; id: string; mode: "move" | "scale" | "rotate" }
  | { kind: "video" }
  | { kind: "subs" }
  | { kind: "none" };

interface GestureState {
  target: Target;
  pointers: Map<number, { x: number; y: number }>;
  start: Map<number, { x: number; y: number }>;
  base: { banner?: Banner; vt?: { x: number; y: number; scale: number }; sub?: { x: number; y: number } };
  moved: boolean;
  t0: number;
  pinch?: { dist: number; angle: number; cx: number; cy: number };
}

function hitBanner(b: Banner, px: number, py: number, W: number, H: number, pad = 0): boolean {
  const cx = (b.x + b.w / 2) * W;
  const cy = (b.y + b.h / 2) * H;
  const a = (-b.rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= (b.w * W) / 2 + pad && Math.abs(ly) <= (b.h * H) / 2 + pad;
}

function Gestures({ W, H, s, getVideo }: { W: number; H: number; s: number; getVideo: () => HTMLVideoElement | null }) {
  const layer = useRef<HTMLDivElement>(null);
  const g = useRef<GestureState | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const banners = useEditor((st) => st.doc!.banners);
  const selection = useEditor((st) => st.selection);
  const eyedropper = useEditor((st) => st.eyedropper);
  const tool = useEditor((st) => st.tool);
  const time = usePlayer((st) => Math.round(st.time * 10) / 10);
  const selected = selection?.kind === "banner" ? banners.find((b) => b.id === selection.id) : undefined;

  const toRef = (e: { clientX: number; clientY: number }) => {
    const r = layer.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };

  const pickEyedropper = (p: { x: number; y: number }) => {
    const st = useEditor.getState();
    const target = st.chromaTarget;
    let color: string | null = null;
    if (target === "video") {
      const v = getVideo();
      const pl = videoPlacement(st.doc!, st.meta!.media!, W, H);
      if (v) color = sampleColor(v, (p.x - pl.x0) / pl.sw, (p.y - pl.y0) / pl.sh);
    } else {
      const b = st.doc!.banners.find((x) => x.id === target);
      const src = bannerSources.get(target)?.();
      if (b && src) {
        const cx = (b.x + b.w / 2) * W;
        const cy = (b.y + b.h / 2) * H;
        const a = (-b.rotation * Math.PI) / 180;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = dx * Math.sin(a) + dy * Math.cos(a);
        color = sampleColor(src, lx / (b.w * W) + 0.5, ly / (b.h * H) + 0.5);
      }
    }
    st.setEyedropper(false);
    if (!color) {
      toast({ title: t("common.error"), tone: "error" });
      return;
    }
    st.update((d) => {
      const apply = (c: ChromaSettings | null | undefined): ChromaSettings => ({
        enabled: true,
        similarity: c?.similarity ?? 0.12,
        blend: c?.blend ?? 0.08,
        spill: c?.spill ?? 0.5,
        color: color!,
      });
      if (target === "video") d.videoChroma = apply(d.videoChroma);
      else {
        const b = d.banners.find((x) => x.id === target);
        if (b) b.chroma = apply(b.chroma);
      }
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toRef(e);
    const st = useEditor.getState();
    if (st.eyedropper) {
      pickEyedropper(p);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (g.current) {
      // second finger: switch to pinch
      g.current.pointers.set(e.pointerId, p);
      g.current.start = new Map(g.current.pointers);
      startPinch();
      return;
    }
    const doc = st.doc!;
    const handle = (e.target as HTMLElement).dataset.handle as "scale" | "rotate" | undefined;
    let target: Target = { kind: "none" };
    const now = usePlayer.getState().time;
    if (handle && selected) {
      target = { kind: "banner", id: selected.id, mode: handle };
    } else {
      const hit = [...doc.banners].reverse().find((b) => bannerState(b, now, W, H).visible && hitBanner(b, p.x, p.y, W, H, 12));
      const sb = subtitleHit.box;
      if (hit) target = { kind: "banner", id: hit.id, mode: "move" };
      else if (sb && p.x >= sb.x - 20 && p.x <= sb.x + sb.w + 20 && p.y >= sb.y - 20 && p.y <= sb.y + sb.h + 20) target = { kind: "subs" };
      else if (st.tool === "format") target = { kind: "video" };
    }
    playback.pause();
    st.beginGesture();
    const pos = doc.subtitles.style.position;
    g.current = {
      target,
      pointers: new Map([[e.pointerId, p]]),
      start: new Map([[e.pointerId, p]]),
      base: {
        banner: target.kind === "banner" ? doc.banners.find((b) => b.id === target.id) : selected,
        vt: { ...doc.videoTransform },
        sub: { x: pos.x, y: pos.y },
      },
      moved: false,
      t0: performance.now(),
    };
    if (target.kind === "banner" && selection?.id !== target.id) st.select({ kind: "banner", id: target.id });
  };

  const startPinch = () => {
    const gs = g.current!;
    const pts = [...gs.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const st = useEditor.getState();
    const doc = st.doc!;
    gs.pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    if (gs.target.kind !== "banner") {
      const sel = st.selection?.kind === "banner" ? doc.banners.find((x) => x.id === st.selection!.id) : undefined;
      if (sel) gs.target = { kind: "banner", id: sel.id, mode: "move" };
      else if (st.tool === "format" || gs.target.kind === "none") gs.target = { kind: "video" };
    }
    gs.base = {
      banner: gs.target.kind === "banner" ? doc.banners.find((x) => x.id === (gs.target as any).id) : undefined,
      vt: { ...doc.videoTransform },
      sub: gs.base.sub,
    };
    gs.moved = true;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const gs = g.current;
    if (!gs || !gs.pointers.has(e.pointerId)) return;
    const p = toRef(e);
    gs.pointers.set(e.pointerId, p);
    const st = useEditor.getState();
    const first = gs.start.values().next().value!;
    const cur = gs.pointers.values().next().value!;
    if (!gs.moved && Math.hypot((cur.x - first.x) * s, (cur.y - first.y) * s) < 4) return;
    gs.moved = true;

    if (gs.pinch && gs.pointers.size >= 2) {
      const [a, b] = [...gs.pointers.values()];
      const f = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, gs.pinch.dist);
      const da = (Math.atan2(b.y - a.y, b.x - a.x) - gs.pinch.angle) * DEG;
      const mx = (a.x + b.x) / 2 - gs.pinch.cx;
      const my = (a.y + b.y) / 2 - gs.pinch.cy;
      if (gs.target.kind === "banner" && gs.base.banner) {
        const b0 = gs.base.banner;
        const id = gs.target.id;
        st.update((d) => {
          const bn = d.banners.find((x) => x.id === id);
          if (!bn) return;
          const cx = b0.x + b0.w / 2 + mx / W;
          const cy = b0.y + b0.h / 2 + my / H;
          bn.w = clamp(b0.w * f, 0.03, 4);
          bn.h = (bn.w * b0.h) / b0.w;
          bn.x = cx - bn.w / 2;
          bn.y = cy - bn.h / 2;
          bn.rotation = snapAngle(b0.rotation + da);
        });
      } else if (gs.target.kind === "video" && gs.base.vt) {
        const vt = gs.base.vt;
        st.update((d) => {
          d.videoTransform.scale = clamp(vt.scale * f, 0.2, 5);
          d.videoTransform.x = clamp(vt.x + mx / W, -2, 2);
          d.videoTransform.y = clamp(vt.y + my / H, -2, 2);
        });
      }
      return;
    }

    const dx = cur.x - first.x;
    const dy = cur.y - first.y;
    const T = gs.target;
    if (T.kind === "banner" && gs.base.banner) {
      const b0 = gs.base.banner;
      const cx0 = (b0.x + b0.w / 2) * W;
      const cy0 = (b0.y + b0.h / 2) * H;
      st.update((d) => {
        const bn = d.banners.find((x) => x.id === T.id);
        if (!bn) return;
        if (T.mode === "move") {
          let cx = cx0 + dx;
          let cy = cy0 + dy;
          const snapV = Math.abs(cx - W / 2) < 10 / s;
          const snapH = Math.abs(cy - H / 2) < 10 / s;
          if (snapV) cx = W / 2;
          if (snapH) cy = H / 2;
          setGuides((gd) => (gd.v === snapV && gd.h === snapH ? gd : { v: snapV, h: snapH }));
          bn.x = cx / W - b0.w / 2;
          bn.y = cy / H - b0.h / 2;
        } else if (T.mode === "scale") {
          const f = Math.hypot(cur.x - cx0, cur.y - cy0) / Math.max(1, Math.hypot(first.x - cx0, first.y - cy0));
          bn.w = clamp(b0.w * f, 0.03, 4);
          bn.h = (bn.w * b0.h) / b0.w;
          bn.x = cx0 / W - bn.w / 2;
          bn.y = cy0 / H - bn.h / 2;
        } else {
          const ang = Math.atan2(cur.y - cy0, cur.x - cx0) * DEG + 90;
          bn.rotation = snapAngle(((ang + 540) % 360) - 180);
        }
      });
    } else if (T.kind === "video" && gs.base.vt) {
      const vt = gs.base.vt;
      let nx = vt.x + dx / W;
      let ny = vt.y + dy / H;
      if (Math.abs(nx) < 8 / s / W) nx = 0;
      if (Math.abs(ny) < 8 / s / H) ny = 0;
      st.update((d) => {
        d.videoTransform.x = clamp(nx, -2, 2);
        d.videoTransform.y = clamp(ny, -2, 2);
      });
    } else if (T.kind === "subs" && gs.base.sub) {
      const sub = gs.base.sub;
      let nx = clamp(sub.x + dx / W, 0.05, 0.95);
      const ny = clamp(sub.y + dy / H, 0.04, 0.96);
      if (Math.abs(nx - 0.5) < 10 / s / W) nx = 0.5;
      setGuides((gd) => (gd.v === (nx === 0.5) && !gd.h ? gd : { v: nx === 0.5, h: false }));
      st.update((d) => {
        d.subtitles.style.position = { preset: "custom", x: nx, y: ny };
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const gs = g.current;
    if (!gs) return;
    gs.pointers.delete(e.pointerId);
    if (gs.pointers.size > 0) {
      // lifted one finger of a pinch: continue as a drag from here
      gs.start = new Map(gs.pointers);
      gs.pinch = undefined;
      const st = useEditor.getState();
      const doc = st.doc!;
      gs.base = {
        banner: gs.target.kind === "banner" ? doc.banners.find((x) => x.id === (gs.target as any).id) : undefined,
        vt: { ...doc.videoTransform },
        sub: { ...doc.subtitles.style.position },
      };
      return;
    }
    const st = useEditor.getState();
    st.endGesture();
    setGuides({ v: false, h: false });
    if (!gs.moved && performance.now() - gs.t0 < 400) {
      // tap
      if (gs.target.kind === "banner") {
        st.select({ kind: "banner", id: gs.target.id });
        if (st.tool !== "banner" && st.tool !== "chroma") st.setTool("banner");
      } else if (gs.target.kind === "subs") {
        if (st.tool !== "subtitles") st.setTool("subtitles");
      } else if (st.selection?.kind === "banner") {
        st.select(null);
      } else {
        playback.toggle();
      }
    }
    g.current = null;
  };

  // selection outline in display px
  const outline = useMemo(() => {
    if (!selected) return null;
    const st = bannerState(selected, time, W, H);
    if (!st.visible) return null;
    return {
      left: selected.x * W * s,
      top: selected.y * H * s,
      width: selected.w * W * s,
      height: selected.h * H * s,
      rotation: selected.rotation,
      dx: st.dx * s,
      dy: st.dy * s,
    };
  }, [selected, time, W, H, s]);

  return (
    <div
      ref={layer}
      className={`absolute inset-0 touch-none select-none ${eyedropper ? "cursor-crosshair" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label="Превью ролика"
    >
      {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent/80" />}
      {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-accent/80" />}
      {outline && tool !== "chroma" && (
        <div
          className="pointer-events-none absolute border-[1.5px] border-accent"
          style={{
            left: outline.left,
            top: outline.top,
            width: outline.width,
            height: outline.height,
            transform: `translate(${outline.dx}px, ${outline.dy}px) rotate(${outline.rotation}deg)`,
          }}
        >
          {(["-top-2.5 -left-2.5", "-top-2.5 -right-2.5", "-bottom-2.5 -left-2.5", "-bottom-2.5 -right-2.5"] as const).map((pos) => (
            <span key={pos} data-handle="scale" className={`pointer-events-auto absolute size-5 rounded-full border-2 border-accent bg-white ${pos} before:absolute before:-inset-3`} aria-label="Масштаб" />
          ))}
          <span className="absolute -top-8 left-1/2 h-6 w-px bg-accent" />
          <span data-handle="rotate" className="pointer-events-auto absolute -top-11 left-1/2 size-6 -translate-x-1/2 rounded-full border-2 border-accent bg-white before:absolute before:-inset-3" aria-label="Поворот" />
        </div>
      )}
      {eyedropper && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="material rounded-full px-3 py-1.5 text-footnote font-medium">{t("chroma.eyedropperHint")}</span>
        </div>
      )}
    </div>
  );
}

function snapAngle(a: number): number {
  for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(a - s) < 4) return s;
  return Math.round(a * 10) / 10;
}
