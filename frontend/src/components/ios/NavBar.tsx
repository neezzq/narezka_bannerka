import { ChevronLeft } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function NavBar({
  title,
  left,
  right,
  large,
  subtitle,
  transparent,
  largeClassName = "",
}: {
  title?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  large?: boolean;
  subtitle?: ReactNode;
  transparent?: boolean;
  /** extra classes for the large title block (e.g. to align it with a centred layout) */
  largeClassName?: string;
}) {
  return (
    <header className={`relative z-30 shrink-0 pt-safe ${transparent ? "" : "material hairline-b"}`}>
      <div className="grid h-[var(--nav-h)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-1.5">
        <div className="flex min-w-0 items-center justify-self-start">{left}</div>
        <div className="min-w-0 max-w-[56vw] text-center">
          {!large && title && <h1 className="truncate text-headline font-semibold">{title}</h1>}
          {!large && subtitle && <div className="truncate text-caption-1 text-label-2">{subtitle}</div>}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-0.5 justify-self-end">{right}</div>
      </div>
      {large && (
        <div className={`px-4 pb-2 ${largeClassName}`}>
          <h1 className="text-large-title font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-subhead text-label-2">{subtitle}</p>}
        </div>
      )}
    </header>
  );
}

export function NavBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ opacity: 0.5 }}
      className="flex h-11 min-w-11 items-center pr-2 text-body text-accent-text"
      aria-label={label}
    >
      <ChevronLeft size={30} strokeWidth={2.2} className="-mr-1" aria-hidden />
      <span className="truncate">{label}</span>
    </motion.button>
  );
}

export function NavTextButton({
  children,
  onClick,
  bold,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  bold?: boolean;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={{ opacity: 0.5 }}
      className={`h-11 px-2.5 text-body text-accent-text disabled:text-label-3 ${bold ? "font-semibold" : ""}`}
    >
      {children}
    </motion.button>
  );
}
