import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import { ThumbStrip } from "@/components/ThumbStrip";
import { formatTimecode } from "@/lib/timecode";
import type { Sprite } from "@/lib/types";

type DragKind = "start" | "end" | "move";

/**
 * Dual-handle range slider over a thumbnail strip (iOS Photos trim style).
 * The visible window is [windowStart, windowEnd]; the selection can be dragged
 * by its handles or moved as a whole. Length is clamped to [minLen, maxLen].
 */
export function RangeSlider({
  windowStart,
  windowEnd,
  duration,
  start,
  end,
  minLen = 0.5,
  maxLen,
  current,
  sprites,
  spritesLoading,
  onChange,
  onSeek,
  onDragEnd,
}: {
  windowStart: number;
  windowEnd: number;
  duration: number;
  start: number;
  end: number;
  minLen?: number;
  maxLen: number;
  current: number | null;
  sprites: Sprite[];
  spritesLoading?: boolean;
  onChange: (start: number, end: number, kind: DragKind) => void;
  onSeek: (t: number) => void;
  onDragEnd?: (kind: DragKind) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: DragKind; x0: number; s0: number; e0: number } | null>(null);
  const span = Math.max(0.001, windowEnd - windowStart);
  const toX = (t: number) => ((t - windowStart) / span) * 100;
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return windowStart + ((clientX - r.left) / r.width) * span;
  };
  const pxToTime = (dx: number) => (dx / track.current!.getBoundingClientRect().width) * span;

  const begin = (kind: DragKind) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x0: e.clientX, s0: start, e0: end };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = pxToTime(e.clientX - d.x0);
    let s = d.s0;
    let en = d.e0;
    if (d.kind === "start") {
      s = Math.min(Math.max(0, d.s0 + dt), d.e0 - minLen);
      if (en - s > maxLen) s = en - maxLen;
      onChange(s, en, "start");
      onSeek(s);
    } else if (d.kind === "end") {
      en = Math.max(Math.min(duration, d.e0 + dt), d.s0 + minLen);
      if (en - s > maxLen) en = s + maxLen;
      onChange(s, en, "end");
      onSeek(en);
    } else {
      const len = d.e0 - d.s0;
      s = Math.min(Math.max(0, d.s0 + dt), duration - len);
      onChange(s, s + len, "move");
      onSeek(s);
    }
  };
  const end_ = () => {
    if (drag.current) onDragEnd?.(drag.current.kind);
    drag.current = null;
  };

  const sx = toX(start);
  const ex = toX(end);
  const handle = "absolute top-0 bottom-0 z-20 flex w-5 cursor-ew-resize touch-none items-center justify-center bg-accent text-on-accent";

  return (
    <div className="select-none">
      <div
        ref={track}
        className="relative h-[60px] touch-none rounded-[10px] bg-surface-2"
        onPointerDown={(e) => onSeek(Math.min(duration, Math.max(0, timeAt(e.clientX))))}
        onPointerMove={move}
        onPointerUp={end_}
        onPointerCancel={end_}
      >
        <ThumbStrip sprites={sprites} start={windowStart} end={windowEnd} height={60} loading={spritesLoading} className="rounded-[10px]" />
        {/* dim outside the selection */}
        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-[10px] bg-black/60" style={{ width: `${Math.max(0, sx)}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-[10px] bg-black/60" style={{ width: `${Math.max(0, 100 - ex)}%` }} />
        {/* selection frame */}
        <div
          className="absolute inset-y-0 z-10 cursor-grab touch-none border-y-[3px] border-accent active:cursor-grabbing"
          style={{ left: `${sx}%`, width: `${Math.max(0, ex - sx)}%` }}
          onPointerDown={begin("move")}
          role="group"
          aria-label={`Выбран отрезок ${formatTimecode(start)}–${formatTimecode(end)}`}
        >
          <div
            className={`${handle} -left-5 rounded-l-[10px]`}
            onPointerDown={begin("start")}
            role="slider"
            aria-label="Начало отрезка"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={start}
            aria-valuetext={formatTimecode(start, true)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") onChange(Math.max(0, start - 0.5), end, "start");
              if (e.key === "ArrowRight") onChange(Math.min(end - minLen, start + 0.5), end, "start");
            }}
          >
            <ChevronLeft size={18} strokeWidth={3} />
            <span className="absolute -inset-x-3 inset-y-0" />
          </div>
          <div
            className={`${handle} -right-5 rounded-r-[10px]`}
            onPointerDown={begin("end")}
            role="slider"
            aria-label="Конец отрезка"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={end}
            aria-valuetext={formatTimecode(end, true)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") onChange(start, Math.max(start + minLen, end - 0.5), "end");
              if (e.key === "ArrowRight") onChange(start, Math.min(duration, Math.min(start + maxLen, end + 0.5)), "end");
            }}
          >
            <ChevronRight size={18} strokeWidth={3} />
            <span className="absolute -inset-x-3 inset-y-0" />
          </div>
        </div>
        {current !== null && current >= windowStart && current <= windowEnd && (
          <div
            className="pointer-events-none absolute -top-1 -bottom-1 z-30 w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]"
            style={{ left: `${toX(current)}%` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-caption-1 tabular-nums text-label-3">
        <span>{formatTimecode(windowStart)}</span>
        <span>{formatTimecode(windowEnd)}</span>
      </div>
    </div>
  );
}

/** Thin overview of the whole video with a draggable window (for long VODs). */
export function OverviewBar({
  duration,
  windowStart,
  windowLen,
  start,
  end,
  onWindow,
}: {
  duration: number;
  windowStart: number;
  windowLen: number;
  start: number;
  end: number;
  onWindow: (ws: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const t = ((clientX - r.left) / r.width) * duration - windowLen / 2;
    onWindow(Math.min(Math.max(0, t), duration - windowLen));
  };
  return (
    <div
      ref={ref}
      className="relative h-8 cursor-pointer touch-none"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        set(e.clientX);
      }}
      onPointerMove={(e) => (e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId) && set(e.clientX)}
      role="slider"
      aria-label="Окно просмотра"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={windowStart}
    >
      <div className="absolute top-1/2 right-0 left-0 h-1.5 -translate-y-1/2 rounded-full bg-fill" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent"
        style={{ left: `${(start / duration) * 100}%`, width: `${Math.max(0.6, ((end - start) / duration) * 100)}%` }}
      />
      <div
        className="absolute top-1 bottom-1 rounded-md border-2 border-label-2"
        style={{ left: `${(windowStart / duration) * 100}%`, width: `${(windowLen / duration) * 100}%` }}
      />
    </div>
  );
}
