import { Check } from "lucide-react";

export const PALETTE = ["#FFFFFF", "#121214", "#A6E22E", "#FFE600", "#FF453A", "#FF9F0A", "#30D158", "#0A84FF", "#BF5AF2", "#FF375F"];

/** Row of colour circles plus a custom colour (native picker). */
export function ColorSwatches({
  value,
  onChange,
  colors = PALETTE,
  label,
}: {
  value: string;
  onChange: (c: string) => void;
  colors?: string[];
  label: string;
}) {
  const v = value.toUpperCase();
  const custom = !colors.some((c) => c.toUpperCase() === v);
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1" role="radiogroup" aria-label={label}>
      {colors.map((c) => {
        const selected = c.toUpperCase() === v;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            onClick={() => onChange(c.toUpperCase())}
            className="relative flex size-11 shrink-0 items-center justify-center"
          >
            <span
              className={`flex size-8 items-center justify-center rounded-full ring-1 ring-inset ring-black/10 ${selected ? "outline-2 outline-offset-2 outline-accent" : ""}`}
              style={{ background: c, outlineStyle: selected ? "solid" : "none" }}
            >
              {selected && <Check size={16} strokeWidth={3} color={isLight(c) ? "#121214" : "#fff"} />}
            </span>
          </button>
        );
      })}
      <label className="relative flex size-11 shrink-0 cursor-pointer items-center justify-center" aria-label="Свой цвет">
        <span
          className="size-8 rounded-full"
          style={{
            background: custom ? v : "conic-gradient(#ff453a, #ffd60a, #30d158, #0a84ff, #bf5af2, #ff453a)",
            outline: custom ? "2px solid var(--color-accent)" : "none",
            outlineOffset: 2,
          }}
        />
        <input
          type="color"
          value={/^#[0-9A-F]{6}$/.test(v) ? v.toLowerCase() : "#ffffff"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

export function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}
