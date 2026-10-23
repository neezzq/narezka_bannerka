import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { create } from "zustand";
import { uid } from "@/lib/id";

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  tone?: "success" | "error" | "info";
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

const useToasts = create<{ items: ToastItem[]; push: (t: ToastItem) => void; dismiss: (id: string) => void }>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items.filter((x) => x.id !== t.id), t].slice(-3) })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

/** Push-notification-like banner at the top of the screen. */
export function toast(item: Omit<ToastItem, "id"> & { id?: string }): string {
  const id = item.id ?? uid();
  useToasts.getState().push({ ...item, id });
  const duration = item.duration ?? (item.action ? 7000 : 3500);
  if (duration > 0) window.setTimeout(() => useToasts.getState().dismiss(id), duration);
  return id;
}

export function ToastHost() {
  const { items, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-2 pt-[calc(var(--safe-top)+6px)]" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout
            role="status"
            initial={{ y: -80, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -60, opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.6, bottom: 0.1 }}
            onDragEnd={(_, info) => info.offset.y < -24 && dismiss(item.id)}
            className="material-thick pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-[22px] px-4 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
          >
            <span className="shrink-0">
              {item.icon ??
                (item.tone === "error" ? (
                  <AlertCircle className="text-danger" size={26} />
                ) : item.tone === "success" ? (
                  <CheckCircle2 className="text-accent" size={26} />
                ) : (
                  <Info className="text-label-2" size={26} />
                ))}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-subhead font-semibold">{item.title}</div>
              {item.message && <div className="text-footnote text-label-2">{item.message}</div>}
            </div>
            {item.action && (
              <button
                type="button"
                className="h-9 shrink-0 rounded-full bg-accent px-3.5 text-subhead font-semibold text-on-accent"
                onClick={() => {
                  item.action!.onClick();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
