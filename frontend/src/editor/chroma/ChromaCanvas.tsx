import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ChromaSettings } from "@/lib/types";
import { ChromaRenderer, type ChromaSource } from "./shader";

export interface ChromaCanvasHandle {
  redraw: () => void;
}

/**
 * Renders `getSource()` through the chroma-key shader. Videos are redrawn on
 * every decoded frame; images/canvases on demand (`redraw`) and on settings change.
 */
export const ChromaCanvas = forwardRef<
  ChromaCanvasHandle,
  {
    getSource: () => ChromaSource | null;
    settings: ChromaSettings;
    pixelWidth: number;
    pixelHeight: number;
    className?: string;
    style?: React.CSSProperties;
    onUnsupported?: () => void;
  }
>(function ChromaCanvas({ getSource, settings, pixelWidth, pixelHeight, className, style, onUnsupported }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ChromaRenderer | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const redraw = () => {
    const src = getSource();
    if (!src || !renderer.current) return;
    renderer.current.draw(src, settingsRef.current);
  };
  useImperativeHandle(ref, () => ({ redraw }));

  useEffect(() => {
    if (!canvas.current) return;
    renderer.current = ChromaRenderer.create(canvas.current);
    if (!renderer.current) onUnsupported?.();
    redraw();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    redraw();
  }, [settings, pixelWidth, pixelHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // video frames
  useEffect(() => {
    const src = getSource();
    if (!(src instanceof HTMLVideoElement)) {
      if (src instanceof HTMLImageElement && !src.complete) src.addEventListener("load", redraw, { once: true });
      return;
    }
    let alive = true;
    let handle = 0;
    const anyVideo = src as any;
    if (typeof anyVideo.requestVideoFrameCallback === "function") {
      const step = () => {
        if (!alive) return;
        redraw();
        handle = anyVideo.requestVideoFrameCallback(step);
      };
      handle = anyVideo.requestVideoFrameCallback(step);
      const onSeeked = () => redraw();
      src.addEventListener("seeked", onSeeked);
      src.addEventListener("loadeddata", onSeeked);
      return () => {
        alive = false;
        anyVideo.cancelVideoFrameCallback?.(handle);
        src.removeEventListener("seeked", onSeeked);
        src.removeEventListener("loadeddata", onSeeked);
      };
    }
    const loop = () => {
      if (!alive) return;
      redraw();
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(handle);
    };
  }, [getSource]);

  return <canvas ref={canvas} width={Math.max(1, Math.round(pixelWidth))} height={Math.max(1, Math.round(pixelHeight))} className={className} style={style} />;
});

/** Read the colour of a source element at normalised coords (eyedropper). */
export function sampleColor(src: ChromaSource, u: number, v: number): string | null {
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const h = src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  if (!w || !h) return null;
  const c = document.createElement("canvas");
  c.width = 5;
  c.height = 5;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const sx = Math.min(w - 5, Math.max(0, Math.round(u * w) - 2));
  const sy = Math.min(h - 5, Math.max(0, Math.round(v * h) - 2));
  try {
    ctx.drawImage(src, sx, sy, 5, 5, 0, 0, 5, 5);
    const d = ctx.getImageData(0, 0, 5, 5).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    const hex = (x: number) => Math.round(x / n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
  } catch {
    return null;
  }
}
