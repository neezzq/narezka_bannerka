import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon: LucideIcon;
  badge?: boolean;
}

export function TabBar<K extends string>({
  items,
  active,
  onChange,
  className = "",
}: {
  items: TabItem<K>[];
  active: K | null;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <nav className={`material hairline-t relative z-20 shrink-0 pb-safe ${className}`} aria-label="Инструменты">
      <div className="flex h-[var(--tab-h)] items-stretch" role="tablist">
        {items.map(({ key, label, icon: Icon, badge }) => {
          const selected = key === active;
          return (
            <motion.button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={label}
              onClick={() => onChange(key)}
              whileTap={{ scale: 0.92 }}
              className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] pt-1 text-caption-2 font-medium transition-colors ${
                selected ? "text-accent-text" : "text-label-2"
              }`}
            >
              <span className="relative">
                <Icon size={24} strokeWidth={selected ? 2 : 1.6} aria-hidden />
                {badge && <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-accent" />}
              </span>
              <span className="max-w-full truncate px-0.5">{label}</span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}
