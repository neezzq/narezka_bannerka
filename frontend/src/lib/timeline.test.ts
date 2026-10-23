import { describe, expect, it } from "vitest";
import fixtures from "../../../shared/fixtures/timeline.json";
import { buildPages, fitScale, lineAnimState, outputDuration, outputToSource, pageAt, sourceToOutput } from "./timeline";
import { presetStyle } from "./subtitles";
import type { Cut, Line, SubtitleStyle } from "./types";

const style = (s: Partial<SubtitleStyle>): SubtitleStyle => ({ ...presetStyle("classic"), ...s });

describe("shared fixtures (same as backend/tests/test_timeline_fixtures.py)", () => {
  for (const c of fixtures.mapping) {
    it(`mapping: ${c.name}`, () => {
      for (const [src, expected] of c.points as [number, number | null][]) {
        const out = sourceToOutput(c.cuts as Cut[], src);
        if (expected === null) expect(out).toBeNull();
        else expect(out).toBeCloseTo(expected, 6);
      }
      expect(outputDuration(c.cuts as Cut[])).toBeCloseTo(c.duration, 6);
    });
  }
  for (const c of fixtures.pages) {
    it(`pages: ${c.name}`, () => {
      const pages = buildPages(c.lines as Line[], c.cuts as Cut[], style(c.style as Partial<SubtitleStyle>));
      expect(pages.map((p) => p.text)).toEqual(c.expected.map((e) => e.text));
      pages.forEach((p, i) => {
        expect(p.start).toBeCloseTo(c.expected[i].start, 3);
        expect(p.end).toBeCloseTo(c.expected[i].end, 3);
      });
    });
  }
});

describe("timeline", () => {
  const cuts: Cut[] = [
    { id: "a", start: 1, end: 3 },
    { id: "b", start: 5, end: 9 },
  ];
  it("maps output time back to source", () => {
    expect(outputToSource(cuts, 0)).toEqual({ index: 0, source: 1 });
    expect(outputToSource(cuts, 2.5)).toEqual({ index: 1, source: 5.5 });
    expect(outputToSource(cuts, 100)).toEqual({ index: 1, source: 9 });
  });
  it("finds the page at a time", () => {
    const pages = buildPages([{ id: "l", words: [{ text: "a", start: 0, end: 1 }, { text: "b", start: 3, end: 4 }] }], [{ id: "c", start: 0, end: 10 }], style({ wordsPerScreen: 1 }));
    expect(pageAt(pages, 0.5)?.text).toBe("a");
    expect(pageAt(pages, 2)).toBeNull();
    expect(pageAt(pages, 3.5)?.text).toBe("b");
  });
  it("animates line appearance", () => {
    expect(lineAnimState(style({ animation: "pop" }), 1, 1)).toEqual({ alpha: 0, scale: 0.6, dy: 0 });
    expect(lineAnimState(style({ animation: "slide" }), 1, 1.1).dy).toBeCloseTo(20);
    expect(lineAnimState(style({ animation: "fade" }), 1, 5).alpha).toBe(1);
  });
  it("fits wide lines into the frame", () => {
    expect(fitScale(500, style({ outlineWidth: 0 }), 1080)).toBe(1);
    expect(fitScale(2000, style({ outlineWidth: 0 }), 1080)).toBeCloseTo((0.92 * 1080) / 2000);
  });
});
