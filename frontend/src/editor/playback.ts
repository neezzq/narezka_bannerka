// Playback of the output timeline (concatenated cuts) on a single <video>
// element that plays the source proxy. Jumps over removed parts.
import { create } from "zustand";
import { reportError } from "@/lib/report";
import { cutOffsets, outputDuration, outputToSource } from "@/lib/timeline";
import type { Cut } from "@/lib/types";

interface PlayerState {
  time: number;
  playing: boolean;
  duration: number;
}

export const usePlayer = create<PlayerState>()((_set, _get, api) => {
  // isolate subscribers: one failing view (canvas, banner sync) must not stop
  // the clock or the other views, which zustand would otherwise skip
  const subscribe = api.subscribe;
  api.subscribe = (listener) =>
    subscribe((state, prev) => {
      try {
        listener(state, prev);
      } catch (err) {
        reportError(err, "player");
      }
    });
  return { time: 0, playing: false, duration: 0 };
});

const EPS = 1 / 60;

class PlaybackEngine {
  video: HTMLVideoElement | null = null;
  cuts: Cut[] = [];
  offsets: number[] = [];
  index = 0;
  private raf = 0;
  private lastStep = 0;
  private switching = false;
  private detach: (() => void) | null = null;

  attach(video: HTMLVideoElement | null) {
    if (this.video === video) return;
    this.pause();
    this.detach?.();
    this.detach = null;
    this.video = video;
    if (!video) return;
    const handlers: [string, () => void][] = [
      ["loadedmetadata", () => this.seek(usePlayer.getState().time)],
      // started by us, by the OS (lock screen, headphones) or resumed after buffering
      ["playing", () => {
        if (video.paused) return;
        if (!usePlayer.getState().playing) usePlayer.setState({ playing: true });
        this.loop();
      }],
      ["pause", () => {
        if (usePlayer.getState().playing && !video.ended && !this.switching) this.pause();
      }],
      // fallback clock: Safari may throttle or stall animation frames
      ["timeupdate", () => {
        if (usePlayer.getState().playing && performance.now() - this.lastStep > 250) this.step();
      }],
      ["ended", () => {
        if (usePlayer.getState().playing) this.step();
      }],
    ];
    for (const [type, fn] of handlers) video.addEventListener(type, fn);
    this.detach = () => {
      for (const [type, fn] of handlers) video.removeEventListener(type, fn);
    };
  }

  setCuts(cuts: Cut[]) {
    this.cuts = cuts;
    this.offsets = cutOffsets(cuts);
    const duration = outputDuration(cuts);
    const time = Math.min(usePlayer.getState().time, duration);
    usePlayer.setState({ duration, time });
    if (!usePlayer.getState().playing) this.seek(time);
  }

  seek(t: number) {
    const duration = usePlayer.getState().duration;
    const time = Math.max(0, Math.min(duration, t));
    usePlayer.setState({ time });
    if (!this.cuts.length || !this.video) return;
    const { index, source } = outputToSource(this.cuts, time);
    this.index = index;
    if (Math.abs(this.video.currentTime - source) > 0.001) {
      try {
        this.video.currentTime = source;
      } catch {
        /* not ready yet */
      }
    }
  }

  play() {
    const v = this.video;
    if (!v || !this.cuts.length) return;
    const { time, duration } = usePlayer.getState();
    this.seek(time >= duration - 0.05 ? 0 : time);
    usePlayer.setState({ playing: true });
    // the clock runs from the element's currentTime, so it can start before
    // play() settles (on iOS the promise may resolve late)
    this.loop();
    const started = v.play();
    started?.catch(() => {
      if (this.video === v && v.paused) this.pause();
    });
  }

  pause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (usePlayer.getState().playing) usePlayer.setState({ playing: false });
    this.video?.pause();
  }

  toggle() {
    if (usePlayer.getState().playing) this.pause();
    else this.play();
  }

  private loop() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.raf = 0;
    if (!usePlayer.getState().playing) return;
    this.step();
    if (usePlayer.getState().playing && !this.raf) this.raf = requestAnimationFrame(this.tick);
  };

  /** Advance the output clock from the element's position. */
  private step() {
    this.lastStep = performance.now();
    const v = this.video;
    if (!v) return;
    try {
      let cut = this.cuts[this.index];
      if (!cut) return this.pause();
      const src = v.currentTime;
      if (src < cut.start - 0.25 || src > cut.end + 0.25) {
        // the element moved on its own (seek, OS controls): follow it
        const i = this.cuts.findIndex((c) => src >= c.start && src < c.end);
        const next = i >= 0 ? i : this.cuts.findIndex((c) => c.start > src);
        if (next < 0) return this.finish();
        this.index = next;
        cut = this.cuts[next];
        if (i < 0) return this.jump(cut);
      }
      if (src >= cut.end - EPS || v.ended) {
        const next = this.cuts[this.index + 1];
        if (!next) return this.finish();
        this.index += 1;
        return this.jump(next);
      }
      usePlayer.setState({ time: this.offsets[this.index] + Math.max(0, src - cut.start) });
    } catch (err) {
      // a failing subscriber must not stop the clock
      reportError(err, "playback");
    }
  }

  private jump(cut: Cut) {
    const v = this.video!;
    this.switching = true;
    try {
      v.currentTime = cut.start;
    } finally {
      this.switching = false;
    }
    if (v.paused) v.play().catch(() => undefined);
    usePlayer.setState({ time: this.offsets[this.index] });
  }

  private finish() {
    usePlayer.setState({ time: usePlayer.getState().duration });
    this.pause();
  }
}

export const playback = new PlaybackEngine();

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, [contenteditable]")) return;
    if (e.code === "Space" && playback.video) {
      e.preventDefault();
      playback.toggle();
    }
  });
}
