import { ChevronLeft, ChevronRight, Image as ImageIcon, Type } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tileStyle } from "@/components/ThumbStrip";
import { t } from "@/i18n";
import { formatTimecode } from "@/lib/timecode";
import { cutOffsets, mapInterval, outputDuration } from "@/lib/timeline";
import type { Banner, Cut } from "@/lib/types";
import { useAssets } from "@/store/assets";
import { useEditor } from "@/store/editor";
import { playback, usePlayer } from "./playback";

const CLIP_H = 52;
const SUB_H = 24;
const LANE_H = 24;
const MIN_CUT = 0.2;

type Drag =
  | { kind: "cut-start" | "cut-end"; id: string; x0: number; v0: number }
  | { kind: "banner-move" | "banner-start" | "banner-end"; id: string; x0: number; s0: number; e0: number };

function lanes(banners: Banner[]): Map<string, number> {
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const b of [...banners].sort((a, b) => a.start - b.start)) {
    let lane = ends.findIndex((e) => e <= b.start + 1e-3);
    if (lane < 0) {
      lane = ends.length;
      ends.push(b.end);
    } else ends[lane] = b.end;
    out.set(b.id, lane);
  }
  return out;
}

export function Timeline() {
  const scroller = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  const [pps, setPps] = useState(0);
  const [view, setView] = useState<[number, number]>([0, 0]);
  const cuts = useEditor((s) => s.doc!.cuts);
  const banners = useEditor((s) => s.doc!.banners);
  const lines = useEditor((s) => s.doc!.subtitles.lines);
  const subsEnabled = useEditor((s) => s.doc!.subtitles.enabled);
  const media = useEditor((s) => s.meta!.media!);
  const selection = useEditor((s) => s.selection);
  const assets = useAssets((s) => s.assets);
  const duration = outputDuration(cuts);
  const offsets = useMemo(() => cutOffsets(cuts), [cuts]);
  const expected = useRef<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;

  // container width + initial zoom
  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const minPps = cw && duration ? Math.max(2, (cw * 0.6) / duration) : 2;
  const maxPps = 320;
  useEffect(() => {
    if (cw && duration && !pps) setPps(Math.min(maxPps, Math.max(minPps, (cw * 1.4) / Math.max(duration, 1))));
  }, [cw, duration, pps, minPps]);

  const pad = cw / 2;
  const contentW = duration * pps;

  // time → scroll (programmatic)
  useLayoutEffect(() => {
    if (!pps) return;
    const el = scroller.current!;
    const apply = (time: number) => {
      const x = time * ppsRef.current;
      if (Math.abs(el.scrollLeft - x) < 0.5) return;
      expected.current = x;
      el.scrollLeft = x;
    };
    apply(usePlayer.getState().time);
    return usePlayer.subscribe((s, prev) => {
      if (s.time !== prev.time && !drag.current) apply(s.time);
    });
  }, [pps, contentW]);

  const updateView = () => {
    const el = scroller.current;
    if (!el) return;
    setView([el.scrollLeft - pad - cw, el.scrollLeft - pad + 2 * cw]);
  };
  useEffect(updateView, [cw, pps]); // eslint-disable-line react-hooks/exhaustive-deps

  const raf = useRef(0);
  const userAt = useRef(0);
  const onScroll = () => {
    const el = scroller.current!;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(updateView);
    const programmatic = expected.current !== null && Math.abs(el.scrollLeft - expected.current) < 2;
    expected.current = null;
    if (programmatic) return;
    if (usePlayer.getState().playing) {
      // while playing only a finger or a wheel moves the strip; anything else
      // is a late event of our own scrolling (Safari delivers them async)
      if (performance.now() - userAt.current > 1000) return;
      playback.pause();
    }
    playback.seek(el.scrollLeft / ppsRef.current);
  };

  // pinch zoom (touch) + ctrl/⌘ wheel (trackpad)
  useEffect(() => {
    const el = scroller.current!;
    let d0 = 0;
    let p0 = 0;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const zoomTo = (v: number) => {
      const time = usePlayer.getState().time;
      const next = Math.min(maxPps, Math.max(minPps, v));
      ppsRef.current = next;
      setPps(next);
      requestAnimationFrame(() => {
        expected.current = time * next;
        el.scrollLeft = time * next;
      });
    };
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        d0 = dist(e);
        p0 = ppsRef.current;
      }
    };
    const tm = (e: TouchEvent) => {
      if (e.touches.length === 2 && d0) {
        e.preventDefault();
        zoomTo((p0 * dist(e)) / d0);
      }
    };
    const te = () => {
      d0 = 0;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(ppsRef.current * Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("wheel", wheel);
    };
  }, [minPps]);

  // ---------------------------------------------------------------- dragging (trim / banner timing)
  const beginDrag = (d: Drag) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    playback.pause();
    useEditor.getState().beginGesture();
    drag.current = { ...d, x0: e.clientX } as Drag;
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = (e.clientX - d.x0) / ppsRef.current;
    const st = useEditor.getState();
    if (d.kind === "cut-start" || d.kind === "cut-end") {
      st.update((doc) => {
        const i = doc.cuts.findIndex((c) => c.id === d.id);
        if (i < 0) return;
        const c = doc.cuts[i];
        if (d.kind === "cut-start") {
          const lo = i > 0 ? doc.cuts[i - 1].end : 0;
          c.start = round3(Math.min(c.end - MIN_CUT, Math.max(lo, d.v0 + dt)));
        } else {
          const hi = i < doc.cuts.length - 1 ? doc.cuts[i + 1].start : media.duration;
          c.end = round3(Math.max(c.start + MIN_CUT, Math.min(hi, d.v0 + dt)));
        }
      });
    } else {
      const bd = d as Extract<Drag, { s0: number }>;
      st.update((doc) => {
        const b = doc.banners.find((x) => x.id === bd.id);
        if (!b) return;
        const total = outputDuration(doc.cuts);
        if (bd.kind === "banner-move") {
          const len = bd.e0 - bd.s0;
          const s = Math.min(Math.max(0, bd.s0 + dt), Math.max(0, total - len));
          b.start = round3(s);
          b.end = round3(s + len);
        } else if (bd.kind === "banner-start") {
          b.start = round3(Math.min(b.end - 0.2, Math.max(0, bd.s0 + dt)));
        } else {
          b.end = round3(Math.max(b.start + 0.2, Math.min(total, bd.e0 + dt)));
        }
      });
    }
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    useEditor.getState().endGesture();
  };

  const select = (s: { kind: "cut" | "banner" | "line"; id: string }, tool: "trim" | "banner" | "subtitles") => {
    const st = useEditor.getState();
    st.select(s);
    if (st.tool !== tool && !(tool === "banner" && st.tool === "chroma")) st.setTool(tool);
  };

  // ---------------------------------------------------------------- ruler
  const step = useMemo(() => {
    for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120]) if (s * pps >= 56) return s;
    return 300;
  }, [pps]);
  const ticks = useMemo(() => {
    const out: number[] = [];
    if (!pps) return out;
    for (let x = 0; x <= duration + 1e-6; x += step) out.push(x);
    return out;
  }, [duration, step, pps]);

  const laneMap = useMemo(() => lanes(banners), [banners]);
  const laneCount = Math.max(1, Math.min(3, Math.max(0, ...laneMap.values()) + 1));
  const lineBlocks = useMemo(
    () =>
      lines
        .map((l) => {
          if (!l.words.length) return null;
          const a = mapInterval(cuts, l.words[0].start, l.words[0].end);
          const b = mapInterval(cuts, l.words[l.words.length - 1].start, l.words[l.words.length - 1].end);
          if (!a && !b) return null;
          return { id: l.id, start: (a ?? b)![0], end: (b ?? a)![1], text: l.words.map((w) => w.text).join(" ") };
        })
        .filter(Boolean) as { id: string; start: number; end: number; text: string }[],
    [lines, cuts],
  );

  const sprite = media.thumbnails;
  const tileW = sprite ? Math.max(28, (CLIP_H * sprite.tileWidth) / sprite.tileHeight) : 40;

  return (
    <div className="relative shrink-0 select-none bg-bg" onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
      <div
        ref={scroller}
        onScroll={onScroll}
        onPointerDown={() => {
          userAt.current = performance.now();
          if (usePlayer.getState().playing) playback.pause();
        }}
        onWheel={() => (userAt.current = performance.now())}
        className="no-scrollbar relative overflow-x-auto overflow-y-hidden"
        style={{ touchAction: "pan-x" }}
        aria-label={t("a11y.timeline")}
      >
        <div className="relative" style={{ width: contentW + 2 * pad, paddingLeft: pad, paddingRight: pad }}>
          {/* ruler */}
          <div className="relative h-5" style={{ width: contentW }}>
            {ticks.map((x) => (
              <div key={x} className="absolute top-0 flex h-5 flex-col items-start" style={{ left: x * pps }}>
                <span className="h-1.5 w-px bg-label-3" />
                <span className="-translate-x-1/2 text-caption-2 tabular-nums text-label-3">{formatTimecode(x)}</span>
              </div>
            ))}
          </div>

          {/* video clips */}
          <div className="relative mt-1" style={{ width: contentW, height: CLIP_H }}>
            {cuts.map((c, i) => (
              <Clip
                key={c.id}
                cut={c}
                left={offsets[i] * pps}
                pps={pps}
                tileW={tileW}
                view={view}
                selected={selection?.kind === "cut" && selection.id === c.id}
                onSelect={() => select({ kind: "cut", id: c.id }, "trim")}
                onTrimStart={beginDrag({ kind: "cut-start", id: c.id, x0: 0, v0: c.start })}
                onTrimEnd={beginDrag({ kind: "cut-end", id: c.id, x0: 0, v0: c.end })}
                sprite={sprite}
              />
            ))}
          </div>

          {/* subtitles */}
          <div className="relative mt-1.5" style={{ width: contentW, height: SUB_H }} aria-label={t("editor.tracks.subtitles")}>
            {lineBlocks.length === 0 && (
              <EmptyTrack label={`+ ${t("editor.tracks.subtitles")}`} width={contentW} onClick={() => useEditor.getState().setTool("subtitles")} />
            )}
            {lineBlocks.map((l) => {
              const sel = selection?.kind === "line" && selection.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    select({ kind: "line", id: l.id }, "subtitles");
                    playback.seek(l.start);
                  }}
                  className={`absolute top-0 flex h-full items-center gap-1 overflow-hidden rounded-[6px] px-1.5 text-left text-caption-2 font-medium ${
                    sel ? "bg-accent text-on-accent" : subsEnabled ? "bg-accent/25 text-label" : "bg-fill-2 text-label-3"
                  }`}
                  style={{ left: l.start * pps, width: Math.max(6, (l.end - l.start) * pps - 2) }}
                >
                  <Type size={11} className="shrink-0" aria-hidden />
                  <span className="truncate">{l.text}</span>
                </button>
              );
            })}
          </div>

          {/* banners */}
          <div className="relative mt-1.5 mb-2" style={{ width: contentW, height: laneCount * (LANE_H + 3) }} aria-label={t("editor.tracks.banners")}>
            {banners.length === 0 && (
              <EmptyTrack label={`+ ${t("editor.tools.banner")}`} width={contentW} onClick={() => useEditor.getState().setTool("banner")} />
            )}
            {banners.map((b) => {
              const lane = Math.min(2, laneMap.get(b.id) ?? 0);
              const sel = selection?.kind === "banner" && selection.id === b.id;
              const asset = assets.find((a) => a.id === b.assetId);
              return (
                <div
                  key={b.id}
                  className={`absolute flex items-center overflow-hidden rounded-[6px] text-caption-2 font-medium ${
                    sel ? "bg-[#5E5CE6] text-white ring-2 ring-white/80" : "bg-[#5E5CE6]/45 text-label"
                  }`}
                  style={{ left: b.start * pps, width: Math.max(8, (b.end - b.start) * pps - 2), top: lane * (LANE_H + 3), height: LANE_H, touchAction: sel ? "none" : "pan-x" }}
                  onPointerDown={sel ? beginDrag({ kind: "banner-move", id: b.id, x0: 0, s0: b.start, e0: b.end }) : undefined}
                  onClick={() => !sel && select({ kind: "banner", id: b.id }, "banner")}
                  role="button"
                  aria-label={t("a11y.bannerRange", { from: formatTimecode(b.start), to: formatTimecode(b.end) })}
                >
                  {sel && (
                    <span className="absolute inset-y-0 left-0 z-10 flex w-4 cursor-ew-resize items-center justify-center bg-white/30" onPointerDown={beginDrag({ kind: "banner-start", id: b.id, x0: 0, s0: b.start, e0: b.end })}>
                      <ChevronLeft size={12} strokeWidth={3} />
                    </span>
                  )}
                  <span className={`flex min-w-0 items-center gap-1 ${sel ? "px-5" : "px-1.5"}`}>
                    {asset?.thumbUrl ? <img src={asset.thumbUrl} alt="" className="size-4 shrink-0 rounded-[3px] object-cover" /> : <ImageIcon size={12} />}
                    <span className="truncate">{asset?.name ?? t("banner.untitled")}</span>
                  </span>
                  {sel && (
                    <span className="absolute inset-y-0 right-0 z-10 flex w-4 cursor-ew-resize items-center justify-center bg-white/30" onPointerDown={beginDrag({ kind: "banner-end", id: b.id, x0: 0, s0: b.start, e0: b.end })}>
                      <ChevronRight size={12} strokeWidth={3} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* fixed centre playhead */}
      <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 z-10 -translate-x-1/2">
        <div className="mx-auto h-full w-[2px] rounded-full bg-white shadow-[0_0_3px_rgba(0,0,0,0.7)]" />
        <div className="absolute top-0 left-1/2 size-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-white" />
      </div>
    </div>
  );
}

function Clip({
  cut,
  left,
  pps,
  tileW,
  view,
  selected,
  onSelect,
  onTrimStart,
  onTrimEnd,
  sprite,
}: {
  cut: Cut;
  left: number;
  pps: number;
  tileW: number;
  view: [number, number];
  selected: boolean;
  onSelect: () => void;
  onTrimStart: (e: React.PointerEvent) => void;
  onTrimEnd: (e: React.PointerEvent) => void;
  sprite: import("@/lib/types").Sprite | undefined;
}) {
  const width = Math.max(4, (cut.end - cut.start) * pps);
  const n = Math.ceil(width / tileW);
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const x = left + i * tileW;
    if (x + tileW < view[0] || x > view[1]) continue;
    const time = cut.start + ((i + 0.5) * tileW) / pps;
    tiles.push(
      <div
        key={i}
        className="absolute top-0 h-full bg-surface-2"
        style={{ left: i * tileW, width: tileW, ...(sprite ? tileStyle([sprite], Math.min(time, cut.end), tileW, CLIP_H) : {}) }}
      />,
    );
  }
  return (
    <div
      className={`absolute top-0 h-full overflow-hidden rounded-[8px] ${selected ? "z-10" : ""}`}
      style={{ left, width: width - 2 }}
      onClick={onSelect}
      role="button"
      aria-pressed={selected}
      aria-label={t("a11y.cutRange", { from: formatTimecode(cut.start), to: formatTimecode(cut.end) })}
    >
      <div className="absolute inset-0">{tiles}</div>
      {selected && (
        <>
          <div className="pointer-events-none absolute inset-0 rounded-[8px] border-y-[3px] border-accent" />
          <div
            className="absolute inset-y-0 left-0 flex w-4 cursor-ew-resize touch-none items-center justify-center rounded-l-[8px] bg-accent text-on-accent"
            onPointerDown={onTrimStart}
            role="slider"
            aria-label={t("a11y.cutStart")}
            aria-valuenow={cut.start}
          >
            <ChevronLeft size={14} strokeWidth={3} />
          </div>
          <div
            className="absolute inset-y-0 right-0 flex w-4 cursor-ew-resize touch-none items-center justify-center rounded-r-[8px] bg-accent text-on-accent"
            onPointerDown={onTrimEnd}
            role="slider"
            aria-label={t("a11y.cutEnd")}
            aria-valuenow={cut.end}
          >
            <ChevronRight size={14} strokeWidth={3} />
          </div>
        </>
      )}
    </div>
  );
}

function EmptyTrack({ label, width, onClick }: { label: string; width: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute inset-y-0 left-0 rounded-[6px] border border-dashed border-label-4 px-2 text-left text-caption-2 font-medium text-label-3"
      style={{ width: Math.max(80, width - 2) }}
    >
      {label}
    </button>
  );
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
