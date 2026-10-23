import { describe, expect, it } from "vitest";
import { formatTimecode, parseRange, parseTimecode } from "./timecode";

describe("timecodes (mirror of backend tests)", () => {
  it.each([
    ["45", 45],
    ["1:23", 83],
    ["1:23.5", 83.5],
    ["1:23,5", 83.5],
    ["1:02:03", 3723],
    ["90:00", 5400],
  ])("parses %s", (text, expected) => expect(parseTimecode(text)).toBeCloseTo(expected));
  it.each(["", "abc", "1:60", "1:75:00", "1::2"])("rejects %s", (text) => expect(() => parseTimecode(text)).toThrow());
  it("parses ranges", () => {
    expect(parseRange("1:23-2:10")).toEqual([83, 130]);
    expect(parseRange("1:23 — 2:10")).toEqual([83, 130]);
    expect(parseRange("10 до 20")).toEqual([10, 20]);
    expect(parseRange("1:23")).toBeNull();
    expect(() => parseRange("2:10-1:23")).toThrow();
  });
  it("formats", () => {
    expect(formatTimecode(83.4)).toBe("1:23");
    expect(formatTimecode(83.46, true)).toBe("1:23.5");
    expect(formatTimecode(3723)).toBe("1:02:03");
  });
});
