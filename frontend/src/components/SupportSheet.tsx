import { Copy, Heart } from "lucide-react";
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { create } from "zustand";
import { Button, Sheet, toast } from "@/components/ios";
import { t } from "@/i18n";

/** The creator's wallets. Each address is valid only in its own network. */
export const WALLETS = [
  { id: "trc20", network: "TRC20 · Tron", coin: "USDT", address: "TQfxtW3Qjm6H7nZPJnJWkbC19hKQXjFzNX" },
  { id: "gram", network: "TON", coin: "GRAM", address: "UQDOa_f9e-Bt2895KofmrfTIlcLLbbbhhOFumwLyAzIwBh1-" },
] as const;

export const useSupport = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** Pill button that opens the wallets sheet. */
export function SupportButton({ className = "", size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <Button variant="tinted" size={size} icon={<Heart size={size === "sm" ? 15 : 18} />} className={className} onClick={useSupport.getState().show}>
      {t("support.button")}
    </Button>
  );
}

function QrCode({ text, size = 132 }: { text: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [text]);
  const m = 2; // quiet zone
  return (
    <svg
      viewBox={`${-m} ${-m} ${path.n + 2 * m} ${path.n + 2 * m}`}
      width={size}
      height={size}
      className="shrink-0 rounded-[10px] bg-white"
      role="img"
      aria-label={t("support.qr")}
      shapeRendering="crispEdges"
    >
      <path d={path.d} fill="#000" />
    </svg>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // older Safari / insecure context: select-and-copy fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast({ title: t("support.copied"), tone: "success" });
}

export function SupportSheet() {
  const open = useSupport((s) => s.open);
  const hide = useSupport((s) => s.hide);
  return (
    <Sheet open={open} onClose={hide} title={t("support.title")} modal detents={["large"]}>
      <div className="space-y-4 px-4 pt-1 pb-6">
        <p className="text-subhead text-label-2">{t("support.text")}</p>
        {WALLETS.map((w) => (
          <section key={w.id} className="rounded-[var(--radius-card)] bg-surface-2 p-4" aria-label={`${w.coin} ${w.network}`}>
            <div className="flex items-start gap-4">
              <QrCode text={w.address} />
              <div className="min-w-0 flex-1">
                <div className="text-headline font-semibold">{w.coin}</div>
                <div className="mt-0.5 inline-flex rounded-full bg-fill-2 px-2 py-0.5 text-caption-1 text-label-2">
                  {t("support.network", { network: w.network })}
                </div>
                <p className="mt-2 font-mono text-footnote break-all select-all">{w.address}</p>
              </div>
            </div>
            <Button variant="gray" size="sm" full className="mt-3" icon={<Copy size={14} />} onClick={() => copy(w.address)}>
              {t("support.copy")}
            </Button>
          </section>
        ))}
        <p className="text-caption-1 text-label-3">{t("support.warning")}</p>
      </div>
    </Sheet>
  );
}
