import { motion } from "framer-motion";
import { Minus, Plus } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { t } from "@/i18n";

// ------------------------------------------------------------------ SegmentedControl

export interface Segment<V extends string | number> {
  value: V;
  label: ReactNode;
  ariaLabel?: string;
}

export function SegmentedControl<V extends string | number>({
  value,
  options,
  onChange,
  className = "",
  size = "md",
  label,
}: {
  value: V;
  options: Segment<V>[];
  onChange: (v: V) => void;
  className?: string;
  size?: "md" | "sm";
  label?: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative flex rounded-[9px] bg-fill-2 p-[2px] ${size === "sm" ? "h-8" : "h-9"} ${className}`}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.ariaLabel}
            onClick={() => onChange(o.value)}
            className={`relative z-10 min-w-0 flex-1 rounded-[7px] px-1.5 text-footnote font-semibold transition-colors before:absolute before:-inset-y-1 before:inset-x-0 ${
              selected ? "text-label" : "text-label-2"
            }`}
          >
            {selected && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-[7px] bg-[var(--seg-thumb,#636366)] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]"
              />
            )}
            <span className="relative flex items-center justify-center gap-1 truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Toggle (UISwitch)

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 before:absolute before:-inset-[7px] ${
        checked ? "bg-accent" : "bg-fill"
      }`}
    >
      <motion.span
        className="absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)]"
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 700, damping: 40 }}
      />
    </button>
  );
}

// ------------------------------------------------------------------ Slider (UISlider)

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  onChangeStart,
  onChangeEnd,
  label,
  format,
  minIcon,
  maxIcon,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: () => void;
  label: string;
  format?: (v: number) => string;
  minIcon?: ReactNode;
  maxIcon?: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const quantize = (v: number) => {
    const q = Math.round((v - min) / step) * step + min;
    return Math.min(max, Math.max(min, Number(q.toFixed(6))));
  };
  const fromEvent = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return quantize(min + ((clientX - r.left) / r.width) * (max - min));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onChangeStart?.();
    onChange(fromEvent(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    onChange(fromEvent(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) onChangeEnd?.();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const big = (max - min) / 10;
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      onChangeStart?.();
      onChange(quantize(value + delta));
      onChangeEnd?.();
    }
  };
  return (
    <div className="flex items-center gap-3">
      {minIcon && <span className="text-label-2">{minIcon}</span>}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format ? format(value) : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative h-11 flex-1 cursor-pointer touch-none select-none"
      >
        <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-full bg-fill" />
        <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${frac * 100}%` }} />
        <div
          className="absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0.5px_4px_rgba(0,0,0,0.12),0_6px_13px_rgba(0,0,0,0.12)]"
          style={{ left: `${frac * 100}%` }}
        />
      </div>
      {maxIcon && <span className="text-label-2">{maxIcon}</span>}
      {format && <span className="w-14 shrink-0 text-right text-subhead tabular-nums text-label-2">{format(value)}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ Stepper (UIStepper)

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Number(v.toFixed(4)))));
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <span className="min-w-8 text-right text-body tabular-nums" aria-live="polite">
        {format ? format(value) : value}
      </span>
      <div className="flex h-8 items-center rounded-lg bg-fill-2">
        <button
          type="button"
          aria-label={t("a11y.less", { label })}
          disabled={value <= min}
          onClick={() => set(value - step)}
          className="relative flex h-8 w-11 items-center justify-center disabled:opacity-30 before:absolute before:-inset-y-1.5 before:inset-x-0"
        >
          <Minus size={18} />
        </button>
        <span className="h-4 w-px bg-separator" />
        <button
          type="button"
          aria-label={t("a11y.more", { label })}
          disabled={value >= max}
          onClick={() => set(value + step)}
          className="relative flex h-8 w-11 items-center justify-center disabled:opacity-30 before:absolute before:-inset-y-1.5 before:inset-x-0"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}
