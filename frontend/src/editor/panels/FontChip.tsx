import { useEffect, useState } from "react";
import { ensureFont, type FontFamily } from "@/lib/fonts";

/** Font picker chip, previewed in the font itself. */
export function FontChip({ family, active, onClick }: { family: FontFamily; active: boolean; onClick: () => void }) {
  const face = family.weights[Math.min(1, family.weights.length - 1)];
  const [, force] = useState(0);
  useEffect(() => {
    ensureFont(face).then(() => force((x) => x + 1));
  }, [face]);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex h-14 shrink-0 flex-col items-center justify-center rounded-[12px] px-3 ${active ? "bg-accent text-on-accent" : "bg-fill-2"}`}
    >
      <span style={{ fontFamily: `"${face.internalName}"`, fontSize: 19, lineHeight: 1.1 }}>Аа</span>
      <span className="text-caption-2">{family.name}</span>
    </button>
  );
}
