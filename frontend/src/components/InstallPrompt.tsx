import { AnimatePresence, motion } from "framer-motion";
import { PlusSquare, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "@/components/ios";
import { t } from "@/i18n";
import { isIOS, isStandalone } from "@/lib/platform";

const DISMISS_KEY = "bk-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  window.dispatchEvent(new Event("bk-installable"));
});

function dismissedRecently(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - ts < 7 * 24 * 3600 * 1000;
  } catch {
    return false;
  }
}

/**
 * "Add to Home Screen" onboarding: iOS Safari gets step-by-step instructions
 * (Share → «На экран „Домой“»), Chrome/Android uses beforeinstallprompt.
 * Hidden when already running standalone.
 */
export function InstallPrompt() {
  const [mode, setMode] = useState<"ios" | "prompt" | null>(null);

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return;
    if (isIOS()) {
      const timer = window.setTimeout(() => setMode("ios"), 1800);
      return () => clearTimeout(timer);
    }
    const onInstallable = () => setMode("prompt");
    if (deferred) onInstallable();
    window.addEventListener("bk-installable", onInstallable);
    return () => window.removeEventListener("bk-installable", onInstallable);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setMode(null);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    setMode(null);
  };

  return (
    <AnimatePresence>
      {mode && (
        <motion.aside
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="material-thick fixed inset-x-3 bottom-[calc(var(--safe-bottom)+12px)] z-[60] mx-auto max-w-[440px] rounded-[20px] p-4 shadow-[0_12px_48px_rgba(0,0,0,0.45)]"
          aria-label={t("install.title")}
        >
          <div className="flex items-start gap-3">
            <img src="/icons/icon-192.png" alt="" className="size-12 shrink-0 rounded-[12px]" />
            <div className="min-w-0 flex-1">
              <h2 className="text-headline font-semibold">{t("install.title")}</h2>
              <p className="mt-0.5 text-footnote text-label-2">{t("install.text")}</p>
            </div>
            <IconButton label={t("install.later")} tone="label" size={32} onClick={dismiss} className="-mt-1 -mr-1 bg-fill-2">
              <X size={16} strokeWidth={2.5} />
            </IconButton>
          </div>
          {mode === "ios" ? (
            <ol className="mt-3 space-y-2 rounded-[12px] bg-fill-2 p-3 text-subhead">
              <li className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-surface text-[#0A84FF]">
                  <Share size={18} />
                </span>
                1. {t("install.iosStep1")}
              </li>
              <li className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-surface">
                  <PlusSquare size={18} />
                </span>
                2. {t("install.iosStep2")}
              </li>
              <li className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-surface text-footnote font-semibold text-[#0A84FF]">
                  Доб.
                </span>
                3. {t("install.iosStep3")}
              </li>
            </ol>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button variant="gray" onClick={dismiss} className="flex-1">
                {t("install.later")}
              </Button>
              <Button onClick={install} className="flex-1">
                {t("install.button")}
              </Button>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
