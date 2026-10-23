// Subtitle fonts: the same TTF files libass uses at export (public/fonts, see scripts/fetch_fonts.py).

export interface FontWeight {
  weight: number;
  file: string;
  internalName: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  assRatio: number;
}

export interface FontFamily {
  id: string;
  name: string;
  weights: FontWeight[];
}

let catalogPromise: Promise<FontFamily[]> | null = null;
let catalogCache: FontFamily[] | null = null;
const loaded = new Map<string, Promise<void>>();

export function loadCatalog(): Promise<FontFamily[]> {
  if (!catalogPromise) {
    catalogPromise = fetch("/fonts/fonts.json")
      .then((r) => r.json())
      .then((c: FontFamily[]) => {
        catalogCache = c;
        return c;
      })
      .catch(() => {
        catalogPromise = null;
        return [];
      });
  }
  return catalogPromise;
}

export function catalogSync(): FontFamily[] | null {
  return catalogCache;
}

/** Closest available weight (same rule as backend/app/render/fonts.py). */
export function resolveFace(catalog: FontFamily[], familyId: string, weight: number): FontWeight | null {
  const fam = catalog.find((f) => f.id === familyId) ?? catalog.find((f) => f.id === "montserrat") ?? catalog[0];
  if (!fam) return null;
  return [...fam.weights].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || b.weight - a.weight)[0];
}

/** Register the face under its internal name (used by canvas `ctx.font`). */
export function ensureFont(face: FontWeight): Promise<void> {
  let p = loaded.get(face.internalName);
  if (!p) {
    const ff = new FontFace(face.internalName, `url(/fonts/${face.file})`);
    p = ff
      .load()
      .then((f) => {
        (document.fonts as any).add(f);
      })
      .catch(() => {
        loaded.delete(face.internalName);
      });
    loaded.set(face.internalName, p);
  }
  return p;
}

export function fontLoaded(face: FontWeight): boolean {
  return document.fonts.check(`16px "${face.internalName}"`);
}
