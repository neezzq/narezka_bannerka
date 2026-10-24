import {
  ArrowDownToLine,
  ArrowUpToLine,
  BringToFront,
  Copy,
  Film,
  ImagePlus,
  Pipette,
  RotateCcw,
  SendToBack,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Button, confirmDialog, EmptyState, FieldRow, ProgressBar, Slider, toast } from "@/components/ios";
import { t } from "@/i18n";
import { bannerPreset, frameSize, type BannerPreset } from "@/lib/geometry";
import { formatTimecode } from "@/lib/timecode";
import { outputDuration } from "@/lib/timeline";
import type { Anim, Asset, Banner } from "@/lib/types";
import { useApp } from "@/store/app";
import { isTextAsset, useAssets } from "@/store/assets";
import { useEditor } from "@/store/editor";
import { addBanner, duplicateBanner, removeBanner } from "../actions";
import { playback, usePlayer } from "../playback";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
const ANIMS: Anim[] = ["none", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "scale"];
const PRESETS: { id: BannerPreset; icon: string }[] = [
  { id: "tl", icon: "↖" },
  { id: "tr", icon: "↗" },
  { id: "center", icon: "◎" },
  { id: "bl", icon: "↙" },
  { id: "br", icon: "↘" },
  { id: "lower", icon: "▁" },
  { id: "full", icon: "▣" },
];

export function BannersPanel() {
  const { assets: all, loaded, uploads, load, upload, remove } = useAssets();
  const assets = all.filter((a) => !isTextAsset(a));
  const banners = useEditor((s) => s.doc!.banners).filter((b) => !b.text);
  const selection = useEditor((s) => s.selection);
  const maxMb = useApp((s) => s.config.maxBannerMb);
  const file = useRef<HTMLInputElement>(null);
  const selected = selection?.kind === "banner" ? banners.find((b) => b.id === selection.id) : undefined;

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const onFiles = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (f.size > maxMb * 1024 * 1024) {
        toast({ title: t("errors.uploadSize", { mb: maxMb }), tone: "error" });
        continue;
      }
      try {
        const asset = await upload(f);
        addBanner(asset);
      } catch (e) {
        toast({ title: (e as Error).message, tone: "error" });
      }
    }
  };

  const removeAsset = async (a: Asset) => {
    const ok = await confirmDialog({ title: t("banner.deleteAsset"), message: t("banner.deleteAssetText"), confirmText: t("common.delete"), destructive: true });
    if (ok) remove(a.id).catch((e) => toast({ title: e.message, tone: "error" }));
  };

  return (
    <div className="pb-6">
      <FieldRow label={t("banner.library")}>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pt-1 pb-1">
          <button
            type="button"
            onClick={() => file.current?.click()}
            className="flex size-[76px] shrink-0 flex-col items-center justify-center gap-1 rounded-[12px] border-[1.5px] border-dashed border-accent/70 text-accent-text"
          >
            <ImagePlus size={22} />
            <span className="text-caption-2 font-semibold">{t("banner.upload")}</span>
          </button>
          {uploads.map((u) => (
            <div key={u.id} className="flex size-[76px] shrink-0 flex-col items-center justify-center gap-2 rounded-[12px] bg-fill-2 px-2">
              <ActivityIndicator size={18} />
              <ProgressBar value={u.progress} className="w-full" />
              <span className="text-caption-2 text-label-2">{u.stage === "processing" ? t("banner.processing") : `${Math.round(u.progress * 100)}%`}</span>
            </div>
          ))}
          {assets.map((a) => (
            <div key={a.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => a.status === "ready" && addBanner(a)}
                aria-label={t("a11y.addAsset", { name: a.name })}
                className="relative block size-[76px] overflow-hidden rounded-[12px] bg-[repeating-conic-gradient(#3a3a3c_0%_25%,#2c2c2e_0%_50%)] bg-[length:16px_16px]"
              >
                {a.thumbUrl && <img src={a.thumbUrl} alt="" className="size-full object-contain" loading="lazy" />}
                {a.kind !== "image" && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{a.kind === "gif" ? "GIF" : <Film size={10} />}</span>
                )}
              </button>
              <button
                type="button"
                aria-label={t("a11y.deleteAsset", { name: a.name })}
                onClick={() => removeAsset(a)}
                className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-surface-3 text-label-2 shadow"
              >
                <X size={12} strokeWidth={3} />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-caption-1 text-label-3">{t("banner.uploadHint", { mb: maxMb })}</p>
        {loaded && !assets.length && !uploads.length && <p className="mt-1 text-footnote text-label-2">{t("banner.emptyLibrary")}</p>}
        <input ref={file} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }} />
      </FieldRow>

      <FieldRow label={t("banner.inProject")}>
        {banners.length === 0 ? (
          <p className="text-footnote text-label-2">{t("banner.noBanners")}</p>
        ) : (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {banners.map((b, i) => {
              const a = assets.find((x) => x.id === b.assetId);
              const sel = selected?.id === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    useEditor.getState().select({ kind: "banner", id: b.id });
                    const now = usePlayer.getState().time;
                    if (now < b.start || now > b.end) playback.seek(b.start + 0.01);
                  }}
                  className={`flex h-12 shrink-0 items-center gap-2 rounded-[10px] px-2 pr-3 ${sel ? "bg-accent/15 ring-2 ring-accent" : "bg-fill-2"}`}
                >
                  <span className="size-8 overflow-hidden rounded-md bg-surface-3">{a?.thumbUrl && <img src={a.thumbUrl} alt="" className="size-full object-cover" />}</span>
                  <span className="text-left">
                    <span className="block text-footnote font-semibold">№{i + 1}</span>
                    <span className="block text-caption-2 tabular-nums text-label-2">
                      {formatTimecode(b.start)}–{formatTimecode(b.end)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </FieldRow>

      {selected ? <BannerInspector banner={selected} asset={assets.find((a) => a.id === selected.assetId)} /> : banners.length > 0 && <EmptyState className="!py-4" title="" text={t("banner.gestureHint")} />}
    </div>
  );
}

/** Placement, timing, animation and order of a banner (text banners use it too). */
export function BannerInspector({ banner, asset }: { banner: Banner; asset?: Asset }) {
  const update = useEditor((s) => s.update);
  const begin = useEditor((s) => s.beginGesture);
  const end = useEditor((s) => s.endGesture);
  const aspect = useEditor((s) => s.doc!.aspect);
  const cuts = useEditor((s) => s.doc!.cuts);
  const total = outputDuration(cuts);
  const set = (fn: (b: Banner) => void) =>
    update((d) => {
      const b = d.banners.find((x) => x.id === banner.id);
      if (b) fn(b as Banner);
    });
  const { width: W, height: H } = frameSize(aspect);
  const ar = asset ? asset.width / Math.max(1, asset.height) : (banner.w * W) / (banner.h * H);

  return (
    <div className="space-y-1 border-t-[0.5px] border-separator pt-2">
      <FieldRow label={t("banner.position")}>
        <div className="grid grid-cols-7 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-label={t(`banner.presets.${p.id}`)}
              title={t(`banner.presets.${p.id}`)}
              onClick={() => set((b) => Object.assign(b, bannerPreset(p.id, b, ar, W, H)))}
              className="flex h-11 items-center justify-center rounded-[10px] bg-fill-2 text-title-3 active:bg-fill"
            >
              {p.icon}
            </button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label={t("banner.opacity")}>
        <Slider label={t("banner.opacity")} value={banner.opacity} min={0.05} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChangeStart={begin} onChangeEnd={end} onChange={(v) => set((b) => void (b.opacity = v))} />
      </FieldRow>
      <FieldRow
        label={t("banner.rotation")}
        hint={
          <button type="button" className="text-caption-1 text-accent-text" onClick={() => set((b) => void (b.rotation = 0))}>
            <RotateCcw size={13} className="inline" /> 0°
          </button>
        }
      >
        <Slider label={t("banner.rotation")} value={banner.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChangeStart={begin} onChangeEnd={end} onChange={(v) => set((b) => void (b.rotation = v))} />
      </FieldRow>

      <FieldRow label={t("banner.time")}>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-[10px] bg-fill-2 px-3 py-1.5">
            <div className="text-caption-2 text-label-2">{t("banner.from")}</div>
            <div className="text-headline tabular-nums">{formatTimecode(banner.start, true)}</div>
          </div>
          <div className="flex-1 rounded-[10px] bg-fill-2 px-3 py-1.5">
            <div className="text-caption-2 text-label-2">{t("banner.to")}</div>
            <div className="text-headline tabular-nums">{formatTimecode(banner.end, true)}</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            variant="gray"
            size="sm"
            icon={<ArrowDownToLine size={14} className="-rotate-90" />}
            onClick={() => {
              const now = usePlayer.getState().time;
              set((b) => {
                b.start = Math.round(Math.min(now, total - 0.2) * 1000) / 1000;
                if (b.end <= b.start + 0.2) b.end = Math.min(total, b.start + 3);
              });
            }}
          >
            {t("banner.fromHere")}
          </Button>
          <Button
            variant="gray"
            size="sm"
            icon={<ArrowUpToLine size={14} className="rotate-90" />}
            onClick={() => {
              const now = usePlayer.getState().time;
              set((b) => {
                b.end = Math.round(Math.max(now, 0.2) * 1000) / 1000;
                if (b.start >= b.end - 0.2) b.start = Math.max(0, b.end - 3);
              });
            }}
          >
            {t("banner.toHere")}
          </Button>
        </div>
      </FieldRow>

      <FieldRow label={t("banner.animIn")}>
        <AnimPicker value={banner.animIn} onChange={(v) => set((b) => void (b.animIn = v))} />
      </FieldRow>
      <FieldRow label={t("banner.animOut")}>
        <AnimPicker value={banner.animOut} onChange={(v) => set((b) => void (b.animOut = v))} />
      </FieldRow>
      <FieldRow label={t("banner.animDuration")}>
        <Slider label={t("banner.animDuration")} value={banner.animDuration} min={0.1} max={2} step={0.05} format={(v) => t("units.seconds", { n: v.toFixed(2).replace(".", ",") })} onChangeStart={begin} onChangeEnd={end} onChange={(v) => set((b) => void (b.animDuration = v))} />
      </FieldRow>

      <div className="grid grid-cols-2 gap-2 px-4 pt-2">
        {!banner.text && <Button
          variant="tinted"
          size="sm"
          icon={<Pipette size={14} />}
          onClick={() => {
            const st = useEditor.getState();
            st.setChromaTarget(banner.id);
            st.setTool("chroma");
          }}
        >
          {t("banner.chroma")}
          {banner.chroma?.enabled ? " ✓" : ""}
        </Button>}
        <Button
          variant="gray"
          size="sm"
          icon={<Copy size={14} />}
          onClick={() => duplicateBanner(banner.id)}
        >
          {t("banner.duplicate")}
        </Button>
        <Button
          variant="gray"
          size="sm"
          icon={<BringToFront size={14} />}
          onClick={() =>
            update((d) => {
              const i = d.banners.findIndex((x) => x.id === banner.id);
              if (i >= 0 && i < d.banners.length - 1) d.banners.push(d.banners.splice(i, 1)[0]);
            })
          }
        >
          {t("banner.toFront")}
        </Button>
        <Button
          variant="gray"
          size="sm"
          icon={<SendToBack size={14} />}
          onClick={() =>
            update((d) => {
              const i = d.banners.findIndex((x) => x.id === banner.id);
              if (i > 0) d.banners.unshift(d.banners.splice(i, 1)[0]);
            })
          }
        >
          {t("banner.toBack")}
        </Button>
      </div>
      <div className="px-4 pt-2">
        <Button
          variant="destructive"
          full
          size="sm"
          icon={<Trash2 size={14} />}
          onClick={() => removeBanner(banner.id)}
        >
          {t("banner.remove")}
        </Button>
      </div>
    </div>
  );
}

function AnimPicker({ value, onChange }: { value: Anim; onChange: (v: Anim) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="radiogroup">
      {ANIMS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          onClick={() => onChange(a)}
          className={`flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-footnote font-medium ${value === a ? "bg-accent text-on-accent" : "bg-fill-2"}`}
        >
          {a === "scale" && <Sparkles size={13} />}
          {t(`banner.anims.${a}`)}
        </button>
      ))}
    </div>
  );
}
