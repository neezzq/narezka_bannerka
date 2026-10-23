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
