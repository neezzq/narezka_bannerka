import { describe, expect, it } from "vitest";
import { bannerState, frameSize, videoPlacement } from "./geometry";
import type { Banner } from "./types";

describe("geometry (mirror of backend/app/render/graph.py)", () => {
  it("computes frame sizes", () => {
    expect(frameSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(frameSize("16:9", 720)).toEqual({ width: 1280, height: 720 });
    expect(frameSize("4:5")).toEqual({ width: 1080, height: 1350 });
  });
  it("places the video (cover / contain)", () => {
    const cover = videoPlacement({ videoTransform: { fit: "cover", scale: 1, x: 0, y: 0 } }, { width: 1920, height: 1080 }, 1080, 1920);
    expect(cover.scale).toBeCloseTo(1920 / 1080);
    expect(cover.x0).toBeCloseTo((1080 - 1920 * (1920 / 1080)) / 2);
    const contain = videoPlacement({ videoTransform: { fit: "contain", scale: 1, x: 0, y: 0.1 } }, { width: 1920, height: 1080 }, 1080, 1920);
    expect(contain.sw).toBeCloseTo(1080);
    expect(contain.y0).toBeCloseTo(960 + 192 - 303.75);
  });
  it("animates banners like the ffmpeg expressions", () => {
    const b: Banner = { id: "b", assetId: "a", x: 0.2, y: 0.3, w: 0.4, h: 0.1, rotation: 0, opacity: 0.8, start: 1, end: 5, animIn: "slide-left", animOut: "fade", animDuration: 0.5, chroma: null };
    expect(bannerState(b, 0.5, 1080, 1920).visible).toBe(false);
    const s0 = bannerState(b, 1, 1080, 1920);
    expect(s0.dx).toBeCloseTo(-648);
    expect(bannerState(b, 1.5, 1080, 1920).dx).toBeCloseTo(0);
    expect(bannerState(b, 4.75, 1080, 1920).alpha).toBeCloseTo(0.4);
  });
});
