import { AnimatePresence, motion } from "framer-motion";
import { create } from "zustand";
import { t } from "@/i18n";

interface DialogRequest {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  alertOnly?: boolean;
  resolve: (ok: boolean) => void;
}

const useDialogStore = create<{ current: DialogRequest | null; set: (d: DialogRequest | null) => void }>((set) => ({
  current: null,
  set: (current) => set({ current }),
}));

/** iOS alert (UIAlertController .alert). Resolves true on confirm. */
export function confirmDialog(opts: Omit<DialogRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().set({
      ...opts,
      resolve: (ok) => {
        useDialogStore.getState().set(null);
        resolve(ok);
      },
    });
  });
}

export function DialogHost() {
  const d = useDialogStore((s) => s.current);
  return (
    <AnimatePresence>
      {d && (
        <motion.div
          key="dialog"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-backdrop p-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            role="alertdialog"
            aria-modal
            aria-labelledby="bk-dialog-title"
            className="material-thick w-[270px] overflow-hidden rounded-[14px] text-center"
            initial={{ scale: 1.15, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          >
            <div className="px-4 pt-5 pb-4">
              <h2 id="bk-dialog-title" className="text-headline font-semibold">
                {d.title}
              </h2>
              {d.message && <p className="mt-1 text-footnote">{d.message}</p>}
            </div>
            <div className={`hairline-t grid ${d.alertOnly ? "grid-cols-1" : "grid-cols-2"}`}>
              {!d.alertOnly && (
                <button type="button" className="h-11 text-body text-accent-text active:bg-fill-2" onClick={() => d.resolve(false)}>
                  {d.cancelText ?? t("common.cancel")}
                </button>
              )}
              <button
                type="button"
                autoFocus
                className={`h-11 text-body font-semibold active:bg-fill-2 ${d.alertOnly ? "" : "border-l-[0.5px] border-separator"} ${
                  d.destructive ? "text-danger" : "text-accent-text"
                }`}
                onClick={() => d.resolve(true)}
              >
                {d.confirmText ?? t("common.ok")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
