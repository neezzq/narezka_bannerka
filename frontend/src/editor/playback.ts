// Playback of the output timeline (concatenated cuts) on a single <video>
// element that plays the source proxy. Jumps over removed parts.
import { create } from "zustand";
import { cutOffsets, outputDuration, outputToSource } from "@/lib/timeline";
import type { Cut } from "@/lib/types";

interface PlayerState {
  time: number;
  playing: boolean;
  duration: number;
}

export const usePlayer = create<PlayerState>(() => ({ time: 0, playing: false, duration: 0 }));

const EPS = 1 / 60;

class PlaybackEngine {
  video: HTMLVideoElement | null = null;
  cuts: Cut[] = [];
  offsets: number[] = [];
  index = 0;
  raf = 0;

  attach(video: HTMLVideoElement | null) {
    if (this.video === video) return;
    this.pause();
    this.video = video;
    if (video) {
      video.addEventListener("loadedmetadata", () => this.seek(usePlayer.getState().time));
      video.addEventListener("pause", () => {
        if (usePlayer.getState().playing && !video.ended && !this.switching) this.pause();
      });
    }
  }

  private switching = false;

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

  async play() {
    const v = this.video;
    if (!v || !this.cuts.length) return;
    const { time, duration } = usePlayer.getState();
    if (time >= duration - 0.05) this.seek(0);
    usePlayer.setState({ playing: true });
    try {
      await v.play();
    } catch {
      usePlayer.setState({ playing: false });
      return;
    }
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    if (usePlayer.getState().playing) usePlayer.setState({ playing: false });
    this.video?.pause();
  }

  toggle() {
    if (usePlayer.getState().playing) this.pause();
    else this.play();
  }

  private tick = () => {
    const v = this.video;
    if (!v || !usePlayer.getState().playing) return;
    const cut = this.cuts[this.index];
    if (!cut) return this.pause();
    let src = v.currentTime;
    if (src < cut.start - 0.25 || src > cut.end + 0.25) {
      // the element drifted (seek in progress / external): re-locate by output time
      this.seek(usePlayer.getState().time);
      src = v.currentTime;
    }
    if (src >= cut.end - EPS || v.ended) {
      const next = this.cuts[this.index + 1];
      if (next) {
        this.index += 1;
        this.switching = true;
        v.currentTime = next.start;
        this.switching = false;
        if (v.paused) v.play().catch(() => undefined);
        usePlayer.setState({ time: this.offsets[this.index] });
      } else {
        usePlayer.setState({ time: usePlayer.getState().duration });
        this.pause();
        return;
      }
    } else {
      const time = this.offsets[this.index] + Math.max(0, src - cut.start);
      usePlayer.setState({ time });
    }
    this.raf = requestAnimationFrame(this.tick);
  };
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
