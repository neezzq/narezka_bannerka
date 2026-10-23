import { useCallback, useEffect, useRef } from "react";
import { bannerState } from "@/lib/geometry";
import type { Asset, Banner } from "@/lib/types";
import { useAssets } from "@/store/assets";
import { ChromaCanvas, type ChromaCanvasHandle } from "../chroma/ChromaCanvas";
import type { ChromaSource } from "../chroma/shader";
import { usePlayer } from "../playback";

/** Global registry so the eyedropper can sample a banner's unkeyed source. */
export const bannerSources = new Map<string, () => ChromaSource | null>();

function gifFrameAt(asset: Asset, localMs: number): number {
  const frames = asset.gif?.frames ?? [];
  const total = frames.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let t = ((localMs % total) + total) % total;
  for (let i = 0; i < frames.length; i++) {
    if (t < frames[i]) return i;
    t -= frames[i];
  }
  return frames.length - 1;
}

function BannerItem({ banner, asset, W, H, displayScale }: { banner: Banner; asset: Asset; W: number; H: number; displayScale: number }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const gifCanvas = useRef<HTMLCanvasElement>(null);
  const sprite = useRef<HTMLImageElement | null>(null);
  const chroma = useRef<ChromaCanvasHandle>(null);
  const lastGifFrame = useRef(-1);
  const bannerRef = useRef(banner);
  bannerRef.current = banner;

  const keyed = !!banner.chroma?.enabled;
  const getSource = useCallback((): ChromaSource | null => {
    if (asset.kind === "video") return video.current;
    if (asset.kind === "gif") return gifCanvas.current;
    return img.current;
  }, [asset.kind]);

  useEffect(() => {
    bannerSources.set(banner.id, getSource);
    return () => {
      bannerSources.delete(banner.id);
    };
  }, [banner.id, getSource]);

  // load the GIF sprite sheet
  useEffect(() => {
    if (asset.kind !== "gif" || !asset.url) return;
    const im = new Image();
    im.src = asset.url;
    im.onload = () => {
      sprite.current = im;
      lastGifFrame.current = -1;
      apply(usePlayer.getState().time, usePlayer.getState().playing);
    };
  }, [asset.url, asset.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawGif = (frame: number) => {
    const c = gifCanvas.current;
    const im = sprite.current;
    const g = asset.gif;
    if (!c || !im || !g) return;
    const ctx = c.getContext("2d")!;
    const col = frame % g.columns;
    const row = Math.floor(frame / g.columns);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(im, col * g.frameWidth, row * g.frameHeight, g.frameWidth, g.frameHeight, 0, 0, c.width, c.height);
    if (keyed) chroma.current?.redraw();
  };

  const apply = (t: number, playing: boolean) => {
    const b = bannerRef.current;
    const el = box.current;
    if (!el) return;
    const st = bannerState(b, t, W, H);
    el.style.visibility = st.visible ? "visible" : "hidden";
    el.style.opacity = String(Math.max(0, Math.min(1, st.alpha)));
    el.style.transform = `translate(${st.dx}px, ${st.dy}px) rotate(${b.rotation}deg) scale(${st.scale})`;
    const local = Math.max(0, t - b.start);
    if (asset.kind === "video" && video.current) {
      const v = video.current;
      const dur = v.duration || asset.duration || 0;
      if (dur > 0) {
        const want = local % dur;
        if (st.visible && playing) {
          if (v.paused) v.play().catch(() => undefined);
          if (Math.abs(v.currentTime - want) > 0.3 && Math.abs(v.currentTime - want) < dur - 0.3) v.currentTime = want;
        } else {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
        }
      }
    }
    if (asset.kind === "gif" && st.visible) {
      const f = gifFrameAt(asset, local * 1000);
      if (f !== lastGifFrame.current) {
        lastGifFrame.current = f;
        drawGif(f);
      }
    }
  };

  useEffect(() => {
    const s = usePlayer.getState();
    apply(s.time, s.playing);
    return usePlayer.subscribe((st) => apply(st.time, st.playing));
  }); // re-subscribe on every render: banner props may change

  const style: React.CSSProperties = {
    position: "absolute",
    left: banner.x * W,
    top: banner.y * H,
    width: banner.w * W,
    height: banner.h * H,
    transformOrigin: "50% 50%",
    willChange: "transform, opacity",
  };
  const media = "absolute inset-0 size-full";
  const pxW = Math.min(1600, banner.w * W * displayScale * (window.devicePixelRatio || 1));
  const pxH = Math.min(1600, banner.h * H * displayScale * (window.devicePixelRatio || 1));

  return (
    <div ref={box} style={style} className="pointer-events-none">
      {asset.kind === "image" && asset.url && (
        <img ref={img} src={asset.url} alt="" draggable={false} className={media} style={{ opacity: keyed ? 0 : 1, objectFit: "fill" }} />
      )}
      {asset.kind === "video" && asset.url && (
        <video ref={video} src={asset.url} muted playsInline loop preload="auto" className={media} style={{ opacity: keyed ? 0 : 1, objectFit: "fill" }} />
      )}
      {asset.kind === "gif" && asset.gif && (
        <canvas ref={gifCanvas} width={asset.gif.frameWidth} height={asset.gif.frameHeight} className={media} style={{ opacity: keyed ? 0 : 1 }} />
      )}
      {keyed && banner.chroma && (
        <ChromaCanvas ref={chroma} getSource={getSource} settings={banner.chroma} pixelWidth={pxW} pixelHeight={pxH} className={media} />
      )}
    </div>
  );
}

export function BannerLayer({ banners, W, H, displayScale }: { banners: Banner[]; W: number; H: number; displayScale: number }) {
  const assets = useAssets((s) => s.assets);
  return (
    <>
      {banners.map((b) => {
        const asset = assets.find((a) => a.id === b.assetId);
        if (!asset || asset.status !== "ready") return null;
        return <BannerItem key={b.id} banner={b} asset={asset} W={W} H={H} displayScale={displayScale} />;
      })}
    </>
  );
}
