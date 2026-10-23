import { useLayoutEffect, useRef, useState } from "react";
import type { Sprite } from "@/lib/types";

/** Find the sprite tile showing time `t`. */
export function spriteTile(sprites: Sprite[], t: number) {
  if (!sprites.length) return null;
  let sp = sprites[0];
  for (const s of sprites) {
    if (s.start <= t) sp = s;
  }
  const idx = Math.max(0, Math.min(sp.count - 1, Math.floor((t - sp.start) / sp.interval)));
  return { sprite: sp, col: idx % sp.columns, row: Math.floor(idx / sp.columns) };
}

export function tileStyle(sprites: Sprite[], t: number, w: number, h: number): React.CSSProperties {
  const tile = spriteTile(sprites, t);
  if (!tile) return {};
  const { sprite: s, col, row } = tile;
  // keep the frame aspect: scale the tile to cover w×h
  const k = Math.max(w / s.tileWidth, h / s.tileHeight);
  const tw = s.tileWidth * k;
  const th = s.tileHeight * k;
  return {
    backgroundImage: `url("${s.url}")`,
    backgroundSize: `${s.columns * tw}px ${s.rows * th}px`,
    backgroundPosition: `${-col * tw - (tw - w) / 2}px ${-row * th - (th - h) / 2}px`,
    backgroundRepeat: "no-repeat",
  };
}

/**
 * A row of thumbnails covering [start, end] (seconds), filling the width.
 * `timeAt(x)` lets callers map tiles to a custom time scale.
 */
export function ThumbStrip({
  sprites,
  start,
  end,
  height = 56,
  className = "",
  loading,
}: {
  sprites: Sprite[];
  start: number;
  end: number;
  height?: number;
  className?: string;
  loading?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const s0 = sprites[0];
  const tileW = s0 ? Math.max(24, (height * s0.tileWidth) / s0.tileHeight) : height * 0.75;
  const n = width ? Math.max(1, Math.ceil(width / tileW)) : 0;
  const tw = n ? width / n : tileW;
  return (
    <div ref={ref} className={`flex overflow-hidden ${className}`} style={{ height }} aria-hidden>
      {sprites.length && !loading
        ? Array.from({ length: n }, (_, i) => {
            const t = start + ((i + 0.5) / n) * (end - start);
            return <div key={i} className="h-full shrink-0 bg-surface-2" style={{ width: tw, ...tileStyle(sprites, t, tw, height) }} />;
          })
        : Array.from({ length: Math.max(1, n) }, (_, i) => (
            <div key={i} className={`h-full shrink-0 border-r border-bg/40 ${loading ? "skeleton !rounded-none" : "bg-surface-2"}`} style={{ width: tw }} />
          ))}
    </div>
  );
}
