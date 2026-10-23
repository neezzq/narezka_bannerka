// Generates PWA icons, apple-touch-icon and iOS splash screens from SVG.
// Usage: npm run icons   (output is committed to public/)
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const BG = "#121214";

// Logo mark on a 512 grid: a salad "screen" with a play triangle and a banner strip.
function mark(size, { pad = 0.18, bg = true, radius = 0 } = {}) {
  const s = 512;
  const inner = s * (1 - pad * 2);
  const k = inner / 512;
  const o = s * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#C5F25A"/><stop offset="1" stop-color="#7FB31A"/>
    </linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#232326"/><stop offset="1" stop-color="${BG}"/>
    </linearGradient>
  </defs>
  ${bg ? `<rect width="${s}" height="${s}" rx="${radius}" fill="url(#bg)"/>` : ""}
  <g transform="translate(${o} ${o}) scale(${k})">
    <rect x="40" y="70" width="432" height="290" rx="56" fill="url(#g)"/>
    <path d="M222 150 L222 280 L330 215 Z" fill="${BG}" stroke="${BG}" stroke-width="18" stroke-linejoin="round"/>
    <rect x="40" y="392" width="300" height="56" rx="28" fill="#A6E22E"/>
    <rect x="360" y="392" width="112" height="56" rx="28" fill="#A6E22E" opacity="0.45"/>
  </g>
</svg>`;
}

const icons = [
  ["icons/icon-192.png", 192, { pad: 0.16 }],
  ["icons/icon-512.png", 512, { pad: 0.16 }],
  ["icons/maskable-512.png", 512, { pad: 0.24 }],
  ["icons/apple-touch-icon.png", 180, { pad: 0.16 }],
  ["icons/favicon-32.png", 32, { pad: 0.08, radius: 96 }],
];

// iPhone portrait screens: [css width, css height, dpr]
export const SPLASH = [
  [440, 956, 3], [402, 874, 3], [420, 912, 3], [430, 932, 3], [393, 852, 3], [390, 844, 3],
  [428, 926, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2], [320, 568, 2],
];

function splash(w, h) {
  const logo = Math.round(Math.min(w, h) * 0.34);
  const x = Math.round((w - logo) / 2);
  const y = Math.round((h - logo) / 2 - h * 0.03);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <g transform="translate(${x} ${y})">${mark(logo, { pad: 0.1, bg: false }).replace(/^<svg[^>]*>|<\/svg>$/g, "")
    .replace("<g transform=\"translate(", `<g transform="scale(${logo / 512}) translate(`)}</g>
</svg>`;
}

async function main() {
  await mkdir(path.join(root, "icons"), { recursive: true });
  await mkdir(path.join(root, "splash"), { recursive: true });
  for (const [file, size, opts] of icons) {
    await sharp(Buffer.from(mark(size, opts))).png().toFile(path.join(root, file));
  }
  await writeFile(path.join(root, "icons", "favicon.svg"), mark(64, { pad: 0.08, radius: 112 }));
  const links = [];
  for (const [cw, ch, dpr] of SPLASH) {
    const w = cw * dpr;
    const h = ch * dpr;
    const file = `splash/iphone-${w}x${h}.png`;
    await sharp(Buffer.from(splash(w, h))).png({ compressionLevel: 9, palette: true }).toFile(path.join(root, file));
    links.push(
      `<link rel="apple-touch-startup-image" href="/${file}" media="(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" />`,
    );
  }
  console.log(links.join("\n"));
}

main();
