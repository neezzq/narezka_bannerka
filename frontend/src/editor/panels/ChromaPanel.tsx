import { Pipette, RotateCcw, Video, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, FieldRow, Slider, Toggle, toast } from "@/components/ios";
import { t } from "@/i18n";
import { isNeutralKey } from "@/lib/chroma";
import type { ChromaSettings } from "@/lib/types";
import { useAssets } from "@/store/assets";
import { useEditor } from "@/store/editor";
import { autoKeyColor } from "../chroma/sample";
import { chromaSource } from "../chroma/target";

const DEFAULT: ChromaSettings = { enabled: true, color: "#00FF00", similarity: 0.12, blend: 0.08, spill: 0.5 };
const KEYS = [
  { color: "#00FF00", label: "chroma.green" },
  { color: "#00B140", label: "chroma.green" },
  { color: "#0047BB", label: "chroma.blue" },
  { color: "#0000FF", label: "chroma.blue" },
];

export function ChromaPanel() {
  const banners = useEditor((s) => s.doc!.banners);
  const videoChroma = useEditor((s) => s.doc!.videoChroma);
  const target = useEditor((s) => s.chromaTarget);
  const eyedropper = useEditor((s) => s.eyedropper);
  const update = useEditor((s) => s.update);
  const begin = useEditor((s) => s.beginGesture);
  const end = useEditor((s) => s.endGesture);
  const assets = useAssets((s) => s.assets);
  const [detecting, setDetecting] = useState(false);
  const [webgl] = useState(() => {
    try {
      return !!document.createElement("canvas").getContext("webgl");
    } catch {
      return false;
    }
  });

  const banner = target !== "video" ? banners.find((b) => b.id === target) : undefined;
  const effectiveTarget = banner ? banner.id : "video";
  const settings: ChromaSettings | null = banner ? banner.chroma : videoChroma;
  const s = settings ?? { ...DEFAULT, enabled: false };

  const set = (fn: (c: ChromaSettings) => void) =>
    update((d) => {
      if (effectiveTarget === "video") {
        d.videoChroma = { ...(d.videoChroma ?? { ...DEFAULT, enabled: false }) };
        fn(d.videoChroma);
      } else {
        const b = d.banners.find((x) => x.id === effectiveTarget);
        if (!b) return;
        b.chroma = { ...(b.chroma ?? { ...DEFAULT, enabled: false }) };
        fn(b.chroma);
      }
    });

  /** Backdrop colour of the target's frame border, or null. */
  const detect = async () => {
    setDetecting(true);
    try {
      const { src, fallback } = chromaSource(effectiveTarget);
      return await autoKeyColor(src, fallback);
    } finally {
      setDetecting(false);
    }
  };

  const enable = async (on: boolean) => {
    if (!on) return set((c) => void (c.enabled = false));
    // first time (or a grey colour left from a wrong pick): find the backdrop
    const color = !settings || isNeutralKey(settings.color) ? ((await detect()) ?? DEFAULT.color) : settings.color;
    set((c) => Object.assign(c, { enabled: true, color }));
  };

  const autoColor = async () => {
    const color = await detect();
    if (color) set((c) => void (c.color = color));
    else toast({ title: t("chroma.autoNotFound"), tone: "info" });
  };

  const selectTarget = (id: string) => {
    const st = useEditor.getState();
    st.setChromaTarget(id);
    if (id !== "video") st.select({ kind: "banner", id });
  };

  const slider = (label: string, key: "similarity" | "blend" | "spill", max: number) => (
    <FieldRow label={label}>
      <Slider
        label={label}
        value={s[key]}
        min={0}
        max={max}
        step={0.005}
        format={(v) => `${Math.round((v / max) * 100)}`}
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(v) => set((c) => void (c[key] = v))}
      />
    </FieldRow>
  );

  return (
    <div className="pb-6">
      {!webgl && <p className="mx-4 mb-2 rounded-[10px] bg-warning/15 p-3 text-footnote">{t("chroma.webglMissing")}</p>}
      <FieldRow label={t("chroma.target")}>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup">
          <TargetChip active={effectiveTarget === "video"} onClick={() => selectTarget("video")} label={t("chroma.video")} icon={<Video size={18} />} on={!!videoChroma?.enabled} />
          {banners.map((b, i) => {
            const a = assets.find((x) => x.id === b.assetId);
            return (
              <TargetChip
                key={b.id}
                active={effectiveTarget === b.id}
                onClick={() => selectTarget(b.id)}
                label={`№${i + 1}`}
                icon={<span className="size-6 overflow-hidden rounded bg-surface-3">{a?.thumbUrl && <img src={a.thumbUrl} alt="" className="size-full object-cover" />}</span>}
                on={!!b.chroma?.enabled}
              />
            );
          })}
        </div>
        {banners.length === 0 && <p className="mt-2 text-footnote text-label-2">{t("chroma.noTargets")}</p>}
      </FieldRow>

      <div className="flex min-h-11 items-center justify-between px-4">
        <span className="text-body">{t("chroma.enabled")}</span>
        <Toggle label={t("chroma.enabled")} checked={s.enabled} onChange={(v) => void enable(v)} />
      </div>

      {s.enabled ? (
        <>
          <FieldRow label={t("chroma.keyColor")}>
            <div className="flex items-center gap-2">
              <span className="size-10 shrink-0 rounded-full ring-2 ring-white/20" style={{ background: s.color }} aria-label={s.color} />
              <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
                {KEYS.map((k) => (
                  <button
                    key={k.color}
                    type="button"
                    aria-label={`${t(k.label)} ${k.color}`}
                    onClick={() => set((c) => void (c.color = k.color))}
                    className={`flex size-11 shrink-0 items-center justify-center rounded-full ${s.color.toUpperCase() === k.color ? "ring-2 ring-accent" : ""}`}
                  >
                    <span className="size-8 rounded-full" style={{ background: k.color }} />
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="tinted" size="sm" icon={<Wand2 size={15} />} disabled={detecting} onClick={() => void autoColor()}>
                {t("chroma.auto")}
              </Button>
              <Button
                variant={eyedropper ? "filled" : "tinted"}
                size="sm"
                icon={<Pipette size={15} />}
                onClick={() => useEditor.getState().setEyedropper(!eyedropper)}
              >
                {t("chroma.eyedropper")}
              </Button>
            </div>
            {isNeutralKey(s.color) && <p className="mt-2 rounded-[10px] bg-warning/15 p-3 text-footnote">{t("chroma.neutralWarning")}</p>}
          </FieldRow>
          {slider(t("chroma.similarity"), "similarity", 0.5)}
          {slider(t("chroma.blend"), "blend", 0.5)}
          {slider(t("chroma.spill"), "spill", 1)}
          <div className="px-4 pt-2">
            <Button variant="gray" size="sm" icon={<RotateCcw size={14} />} onClick={() => set((c) => Object.assign(c, { ...DEFAULT, color: c.color }))}>
              {t("common.reset")}
            </Button>
          </div>
        </>
      ) : (
        <EmptyState className="!py-6" title="" text={t("chroma.noTargets")} />
      )}
    </div>
  );
}

function TargetChip({ active, onClick, label, icon, on }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode; on: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`relative flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-footnote font-semibold ${active ? "bg-accent text-on-accent" : "bg-fill-2"}`}
    >
      {icon}
      {label}
      {on && <span className="size-1.5 rounded-full bg-current" aria-label={t("a11y.enabled")} />}
    </button>
  );
}
