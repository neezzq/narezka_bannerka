import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator } from "@/components/ios";
import { t } from "@/i18n";

export interface PlayerHandle {
  getCurrentTime(): number;
  seekTo(t: number): void;
  play(): void;
  pause(): void;
}

interface PlayerProps {
  onReady?: () => void;
  start?: number;
}

function loadScript(src: string, globalCheck: () => boolean, readyHook?: (cb: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (globalCheck()) return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (readyHook) readyHook(resolve);
    if (!existing) {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onerror = () => reject(new Error("script load failed"));
      if (!readyHook) s.onload = () => resolve();
      document.head.appendChild(s);
    } else if (!readyHook) {
      existing.addEventListener("load", () => resolve());
    }
  });
}

let ytReady: Promise<void> | null = null;
function loadYouTube(): Promise<void> {
  if (!ytReady) {
    const w = window as any;
    ytReady = loadScript(
      "https://www.youtube.com/iframe_api",
      () => !!w.YT?.Player,
      (cb) => {
        const prev = w.onYouTubeIframeAPIReady;
        w.onYouTubeIframeAPIReady = () => {
          prev?.();
          cb();
        };
      },
    );
  }
  return ytReady;
}

function PlayerShell({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <div className="relative size-full bg-black">
      {children}
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-footnote text-label-2">
          <ActivityIndicator size={28} />
          {t("select.playerLoading")}
        </div>
      )}
    </div>
  );
}

/** YouTube IFrame Player API — exact position via getCurrentTime(). */
export const YouTubePlayer = forwardRef<PlayerHandle, PlayerProps & { videoId: string }>(function YouTubePlayer(
  { videoId, start = 0, onReady },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadYouTube().then(() => {
      if (!alive || !host.current) return;
      const el = document.createElement("div");
      host.current.appendChild(el);
      player.current = new (window as any).YT.Player(el, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(start), enablejsapi: 1 },
        events: {
          onReady: () => {
            if (!alive) return;
            setReady(true);
            onReady?.();
          },
        },
      });
    });
    return () => {
      alive = false;
      try {
        player.current?.destroy();
      } catch {
        /* ignore */
      }
      player.current = null;
    };
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => player.current?.getCurrentTime?.() ?? 0,
    seekTo: (t) => player.current?.seekTo?.(t, true),
    play: () => player.current?.playVideo?.(),
    pause: () => player.current?.pauseVideo?.(),
  }));

  return (
    <PlayerShell ready={ready}>
      <div ref={host} className="size-full [&_iframe]:size-full" />
    </PlayerShell>
  );
});

let twitchReady: Promise<void> | null = null;

/** Twitch Embed player (VODs) — getCurrentTime()/seek(). */
export const TwitchPlayer = forwardRef<PlayerHandle, PlayerProps & { videoId: string }>(function TwitchPlayer(
  { videoId, start = 0, onReady },
  ref,
) {
  const id = useId().replace(/:/g, "");
  const player = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const w = window as any;
    twitchReady ??= loadScript("https://player.twitch.tv/js/embed/v1.js", () => !!w.Twitch?.Player);
    twitchReady.then(() => {
      if (!alive) return;
      const h = Math.floor(start / 3600);
      const m = Math.floor((start % 3600) / 60);
      const s = Math.floor(start % 60);
      const p = new w.Twitch.Player(`tw-${id}`, {
        video: `v${videoId}`,
        parent: [location.hostname],
        autoplay: false,
        width: "100%",
        height: "100%",
        time: `${h}h${m}m${s}s`,
      });
      player.current = p;
      p.addEventListener(w.Twitch.Player.READY, () => {
        if (!alive) return;
        setReady(true);
        onReady?.();
      });
    });
    return () => {
      alive = false;
      const el = document.getElementById(`tw-${id}`);
      if (el) el.innerHTML = "";
      player.current = null;
    };
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => player.current?.getCurrentTime?.() ?? 0,
    seekTo: (t) => player.current?.seek?.(t),
    play: () => player.current?.play?.(),
    pause: () => player.current?.pause?.(),
  }));

  return (
    <PlayerShell ready={ready}>
      <div id={`tw-${id}`} className="size-full [&_iframe]:size-full" />
    </PlayerShell>
  );
});

/** Plain <video> for server previews (TikTok, Twitch clips) and uploads. */
export const VideoPlayer = forwardRef<PlayerHandle, PlayerProps & { src: string }>(function VideoPlayer(
  { src, start = 0, onReady },
  ref,
) {
  const v = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  useImperativeHandle(ref, () => ({
    getCurrentTime: () => v.current?.currentTime ?? 0,
    seekTo: (t) => {
      if (v.current) v.current.currentTime = t;
    },
    play: () => void v.current?.play().catch(() => undefined),
    pause: () => v.current?.pause(),
  }));
  return (
    <PlayerShell ready={ready}>
      <video
        ref={v}
        src={src}
        className="size-full object-contain"
        controls
        playsInline
        preload="auto"
        onLoadedMetadata={(e) => {
          if (start) e.currentTarget.currentTime = start;
          setReady(true);
          onReady?.();
        }}
      />
    </PlayerShell>
  );
});
