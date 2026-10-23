import { describe, expect, it } from "vitest";
import { chromaOf, detectKeyColor, isNeutralKey, parseHex } from "./chroma";

function frame(w: number, h: number, bg: [number, number, number, number], fg: [number, number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inner = x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8;
      px.set(inner ? fg : bg, (y * w + x) * 4);
    }
  }
  return px;
}

describe("key colour", () => {
  it("treats black, white and greys as neutral", () => {
    for (const hex of ["#000000", "#FFFFFF", "#808080", "#202020"]) expect(isNeutralKey(hex)).toBe(true);
    for (const hex of ["#00FF00", "#00B140", "#0047BB", "#4CAF50"]) expect(isNeutralKey(hex)).toBe(false);
  });

  it("finds a green screen along the border", () => {
    const px = frame(64, 36, [40, 190, 70, 255], [230, 40, 40, 255]);
    const hex = detectKeyColor(px, 64, 36)!;
    expect(hex).toBe("#28BE46");
  });

  it("ignores a dark or transparent border", () => {
    expect(detectKeyColor(frame(64, 36, [0, 0, 0, 255], [0, 255, 0, 255]), 64, 36)).toBeNull();
    expect(detectKeyColor(frame(64, 36, [0, 255, 0, 0], [255, 0, 0, 255]), 64, 36)).toBeNull();
  });

  it("finds the backdrop when a dark title overlaps the border", () => {
    const px = frame(64, 36, [0, 177, 64, 255], [20, 20, 20, 255]);
    for (let x = 0; x < 30; x++) px.set([0, 0, 0, 255], x * 4); // black strip on the top edge
    const [r, g, b] = parseHex(detectKeyColor(px, 64, 36)!);
    expect(chromaOf(r, g, b)).toBeGreaterThan(60);
    expect(g).toBeGreaterThan(150);
  });
});
