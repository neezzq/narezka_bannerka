import { describe, expect, it } from "vitest";
import { downloadQualities, exportQualities, pickQuality, qualityClass, qualityLabel } from "./quality";

describe("quality", () => {
  it("classifies like the backend", () => {
    expect(qualityClass(1920, 1080)).toBe(1080);
    expect(qualityClass(1080, 1920)).toBe(1080);
    expect(qualityClass(1920, 804)).toBe(1080);
    expect(qualityClass(3840, 2160)).toBe(2160);
    expect(qualityClass(0, 0)).toBe(0);
  });

  it("offers the source qualities and preselects up to 1080p", () => {
    const opts = downloadQualities([2160, 1440, 1080, 720, 480, 360, 240, 144], 3840, 2160, 2160);
    expect(opts).toEqual([2160, 1440, 1080, 720, 480, 360]);
    expect(pickQuality(opts, 1080)).toBe(1080);
    expect(pickQuality([480, 360], 1080)).toBe(480);
    expect(downloadQualities(undefined, 1280, 720, 2160)).toEqual([720, 480, 360]);
    expect(downloadQualities([240], 426, 240, 2160)).toEqual([240]);
    expect(qualityLabel(2160)).toBe("4K");
  });

  it("limits exports to the source", () => {
    expect(exportQualities(1280, 720)).toEqual(["720p", "1080p"]);
    expect(exportQualities(3840, 2160)).toEqual(["720p", "1080p", "1440p", "2160p"]);
  });
});
