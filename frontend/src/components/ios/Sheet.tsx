import { animate, AnimatePresence, motion, useMotionValue } from "framer-motion";
import { X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion, safeAreaInsets } from "@/lib/platform";
import { DESKTOP, useMedia } from "@/lib/useMedia";
import { IconButton } from "./Button";
import { t } from "@/i18n";

export type Detent = "medium" | "large";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 40, mass: 0.9 };

function viewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

export function detentHeight(detent: Detent, vh = viewportHeight(), bottomOffset = 0): number {
  const safeTop = safeAreaInsets().top;
  return detent === "large"
    ? vh - Math.max(safeTop, 20) - 10 - bottomOffset
    : Math.round(Math.min(vh * 0.48, 460) - bottomOffset * 0.5);
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  detent?: Detent;
  detents?: Detent[];
  onDetentChange?: (d: Detent) => void;
  /** dim the content below and close on backdrop tap */
  modal?: boolean;
  /** render as a static side panel (desktop layout) */
  inline?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  label?: string;
  onHeightChange?: (h: number) => void;
  /** keep this many px free at the bottom (e.g. a tab bar that stays visible) */
  bottomOffset?: number;
}

/**
 * iOS bottom sheet: grabber, detents (medium / large), swipe down to close.
 * Dragging works from the header so the content keeps native scrolling.
 */
export function Sheet(props: SheetProps) {
  const desktop = useMedia(DESKTOP);
  if (props.inline) return <InlinePanel {...props} />;
  return (
    <AnimatePresence>
      {props.open && (props.modal && desktop ? <CenterDialog key="dialog" {...props} /> : <FloatingSheet key="sheet" {...props} />)}
    </AnimatePresence>
  );
}

/** Desktop variant of a modal sheet: a dialog in the middle of the window. */
function CenterDialog({ onClose, title, headerLeft, headerRight, children, footer, label, detents = ["medium", "large"] }: SheetProps) {
  const reduced = prefersReducedMotion();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const tall = detents.includes("large");
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-8">
        <motion.section
          role="dialog"
          aria-modal
          aria-label={label ?? (typeof title === "string" ? title : undefined)}
          className={`material-thick pointer-events-auto flex w-full flex-col overflow-hidden rounded-[var(--radius-sheet)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${
            tall ? "max-h-[min(860px,100%)] max-w-[600px]" : "max-h-[min(640px,100%)] max-w-[480px]"
          }`}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
        >
          <SheetHeader title={title} left={headerLeft} right={headerRight} onClose={onClose} />
          <div className="scroll-y min-h-0 flex-1 pb-3">{children}</div>
          {footer && <div className="shrink-0">{footer}</div>}
        </motion.section>
      </div>
    </>
  );
}

function InlinePanel({ open, onClose, title, headerLeft, headerRight, children, footer, label }: SheetProps) {
  if (!open) return null;
  return (
    <section aria-label={label ?? (typeof title === "string" ? title : undefined)} className="flex h-full min-h-0 flex-col bg-surface">
      <SheetHeader title={title} left={headerLeft} right={headerRight} onClose={onClose} />
      <div className="scroll-y min-h-0 flex-1">{children}</div>
      {footer}
    </section>
  );
}

function SheetHeader({
  title,
  left,
  right,
  onClose,
  grabber,
  onPointerDown,
}: {
  title?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onClose: () => void;
  grabber?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  return (
    <div onPointerDown={onPointerDown} className="shrink-0 touch-none select-none">
      {grabber && (
        <div className="flex h-4 items-end justify-center" aria-hidden>
          <div className="h-[5px] w-9 rounded-full bg-label-3" />
        </div>
      )}
      <div className="grid h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-2">
        <div className="flex min-w-0 justify-self-start">{left}</div>
        <h2 className="truncate text-headline font-semibold">{title}</h2>
        <div className="flex items-center justify-self-end">
          {right ?? (
            <IconButton label={t("a11y.close")} tone="label" size={36} onClick={onClose} className="bg-fill-2 !text-label-2">
              <X size={18} strokeWidth={2.5} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

function FloatingSheet({
  onClose,
  title,
  headerLeft,
  headerRight,
  detent = "medium",
  detents = ["medium", "large"],
  onDetentChange,
  modal,
  children,
  footer,
  label,
  onHeightChange,
  bottomOffset = 0,
}: SheetProps) {
  const [vh, setVh] = useState(viewportHeight);
  const heights = useCallback((d: Detent) => detentHeight(d, vh, bottomOffset), [vh, bottomOffset]);
  const h = useMotionValue(0);
  const [current, setCurrent] = useState<Detent>(detent);
  const drag = useRef<{ y: number; h: number; t: number; v: number } | null>(null);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const onResize = () => setVh(viewportHeight());
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      window.visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => setCurrent(detent), [detent]);

  useLayoutEffect(() => {
    const target = heights(current);
    const ctl = animate(h, target, reduced ? { duration: 0 } : SPRING);
    onHeightChange?.(target);
    return () => ctl.stop();
  }, [current, heights]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => onHeightChange?.(0), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: h.get(), t: performance.now(), v: 0 };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const now = performance.now();
      const nh = d.h + (d.y - ev.clientY);
      const max = heights("large");
      const elastic = nh > max ? max + (nh - max) * 0.2 : nh;
      d.v = ((elastic - h.get()) / Math.max(1, now - d.t)) * 1000;
      d.t = now;
      h.set(Math.max(0, elastic));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const cur = h.get();
      const projected = cur + d.v * 0.15;
      const options = detents.map((x) => ({ d: x, h: heights(x) }));
      const minH = Math.min(...options.map((o) => o.h));
      if (projected < minH * 0.55 || d.v < -1600) {
        onClose();
        return;
      }
      const best = options.reduce((a, b) => (Math.abs(b.h - projected) < Math.abs(a.h - projected) ? b : a));
      if (best.d === current) animate(h, best.h, SPRING);
      setCurrent(best.d);
      onDetentChange?.(best.d);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <>
      {modal && (
        <motion.div
          className="fixed inset-0 z-40 bg-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          aria-hidden
        />
      )}
      <motion.section
        role="dialog"
        aria-modal={modal || undefined}
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        className="material-thick fixed inset-x-0 z-50 mx-auto flex max-w-[640px] flex-col overflow-hidden rounded-t-[var(--radius-sheet)] shadow-[0_-8px_40px_rgba(0,0,0,0.35)]"
        style={{ height: h, bottom: bottomOffset }}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={reduced ? { duration: 0 } : SPRING}
      >
        <SheetHeader title={title} left={headerLeft} right={headerRight} onClose={onClose} grabber onPointerDown={onPointerDown} />
        <div className="scroll-y min-h-0 flex-1">{children}</div>
        {footer && <div className={`shrink-0 ${bottomOffset ? "" : "pb-safe"}`}>{footer}</div>}
        {!footer && !bottomOffset && <div className="pb-safe shrink-0" />}
      </motion.section>
    </>
  );
}
