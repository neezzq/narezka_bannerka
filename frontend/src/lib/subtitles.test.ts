import { describe, expect, it } from "vitest";
import { editLineText, groupWords, mergeWithNext, shiftLine, splitLine, wordIndexAtCaret } from "./subtitles";
import type { Line } from "./types";

const line: Line = {
  id: "l1",
  words: [
    { text: "один", start: 0, end: 0.4 },
    { text: "два", start: 0.5, end: 0.8 },
    { text: "три", start: 0.9, end: 1.2 },
  ],
};

describe("subtitle line editing", () => {
  it("keeps timings when the word count is unchanged", () => {
    const l = editLineText(line, "Один Два Три!");
    expect(l.words.map((w) => w.text)).toEqual(["Один", "Два", "Три!"]);
    expect(l.words[1].start).toBe(0.5);
  });
  it("redistributes timings when words are added", () => {
    const l = editLineText(line, "один два три четыре");
    expect(l.words).toHaveLength(4);
    expect(l.words[0].start).toBe(0);
    expect(l.words[3].end).toBeLessThanOrEqual(1.2);
  });
  it("splits, merges and shifts", () => {
    const split = splitLine([line], "l1", 1);
    expect(split).toHaveLength(2);
    expect(split[1].words[0].text).toBe("два");
    const merged = mergeWithNext(split, split[0].id);
    expect(merged).toHaveLength(1);
    expect(merged[0].words).toHaveLength(3);
    const shifted = shiftLine([line], "l1", -1);
    expect(shifted[0].words[0].start).toBe(0); // clamped at 0
    expect(wordIndexAtCaret("один два три", 6)).toBe(1);
  });
  it("groups words like the backend", () => {
    const words = [
      { text: "Привет.", start: 0, end: 0.4 },
      { text: "Как", start: 0.5, end: 0.7 },
      { text: "дела", start: 0.8, end: 1.0 },
      { text: "после", start: 2.5, end: 2.8 },
    ];
    expect(groupWords(words).map((l) => l.words.map((w) => w.text).join(" "))).toEqual(["Привет.", "Как дела", "после"]);
  });
});
