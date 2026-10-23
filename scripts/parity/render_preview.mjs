// Browser-side renders with the real preview code (canvas subtitles, WebGL chroma).
//   node scripts/parity/render_preview.mjs OUT_DIR [http://localhost:5173]
// Needs the Vite dev server running and `playwright` installed (npm i -D playwright).
// Set CHROMIUM_PATH to use a preinstalled Chromium.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const out = path.resolve(process.argv[2] ?? "parity-out");
const base = process.argv[3] ?? "http://localhost:5173";
const data = JSON.parse(fs.readFileSync(path.join(out, "cases.json"), "utf8"));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.goto(base);
const save = (name, dataUrl) => fs.writeFileSync(path.join(out, name), Buffer.from(dataUrl.split(",")[1], "base64"));

for (const c of data.subtitles) {
  const url = await page.evaluate(
    async ({ style, lines }) => {
      const fonts = await import("/src/lib/fonts.ts");
      const tl = await import("/src/lib/timeline.ts");
      const rs = await import("/src/editor/subtitles/renderSubtitles.ts");
      const face = fonts.resolveFace(await fonts.loadCatalog(), style.fontFamily, style.fontWeight);
      await fonts.ensureFont(face);
      const canvas = Object.assign(document.createElement("canvas"), { width: 720, height: 1280 });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 720, 1280);
      const k = 720 / 1080;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const pages = tl.buildPages(lines, [{ id: "c", start: 0, end: 10 }], style);
      rs.drawSubtitles(ctx, document.createElement("canvas"), { page: tl.pageAt(pages, 1.5), style, face, frameW: 1080, frameH: 1920, t: 1.5, k });
      return canvas.toDataURL("image/png");
    },
    { style: c.style, lines: data.lines },
  );
  save(`sub-${c.name}-preview.png`, url);
}

const src = "data:image/png;base64," + fs.readFileSync(path.join(out, "chroma-src.png")).toString("base64");
for (const c of data.chroma) {
  const url = await page.evaluate(
    async ({ src, settings }) => {
      const { ChromaRenderer } = await import("/src/editor/chroma/shader.ts");
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
      ChromaRenderer.create(canvas).draw(img, settings);
      return canvas.toDataURL("image/png");
    },
    { src, settings: c.c },
  );
  save(`chroma-${c.name}-preview.png`, url);
}
await browser.close();
console.log(`preview renders in ${out}`);
