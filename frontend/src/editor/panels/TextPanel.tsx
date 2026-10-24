import { AlignCenter, AlignLeft, AlignRight, Plus, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, ColorSwatches, EmptyState, FieldRow, SegmentedControl, Slider, Toggle, toast } from "@/components/ios";
import { t } from "@/i18n";
import { resolveFace } from "@/lib/fonts";
import { frameSize } from "@/lib/geometry";
import { formatTimecode } from "@/lib/timecode";
import type { Banner, TextSpec } from "@/lib/types";
import { useAssets } from "@/store/assets";
import { useEditor } from "@/store/editor";
import { playback, usePlayer } from "../playback";
import { useFontCatalog } from "../subtitles/SubtitleCanvas";
import { DEFAULT_TEXT, TEXT_PRESETS } from "../text/renderText";
import { addTextBanner, resizeText, restyleText, textFontSize } from "../text/textBanners";
import { BannerInspector } from "./BannersPanel";
import { FontChip } from "./FontChip";

export function TextPanel() {
  const banners = useEditor((s) => s.doc!.banners);
  const selection = useEditor((s) => s.selection);
  const texts = banners.filter((b) => b.text);
  const selected = selection?.kind === "banner" ? texts.find((b) => b.id === selection.id) : undefined;
  const [adding, setAdding] = useState(false);

  const add = async () => {
    setAdding(true);
    try {
      await addTextBanner(t("text.placeholder"));
    } catch (e) {
      toast({ title: (e as Error).message, tone: "error" });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="pb-6">
      <div className="px-4 pt-1 pb-2">
        <Button full icon={<Plus size={18} />} loading={adding} onClick={add}>
          {t("text.add")}
        </Button>
      </div>
      {texts.length > 0 && (
        <FieldRow label={t("text.inProject")}>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {texts.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  useEditor.getState().select({ kind: "banner", id: b.id });
                  const now = usePlayer.getState().time;
                  if (now < b.start || now > b.end) playback.seek(b.start + 0.01);
                }}
                className={`flex h-12 max-w-[200px] shrink-0 items-center gap-2 rounded-[10px] px-2.5 ${selected?.id === b.id ? "bg-accent/15 ring-2 ring-accent" : "bg-fill-2"}`}
              >
                <Type size={16} className="shrink-0 text-label-2" />
                <span className="min-w-0 text-left">
                  <span className="block truncate text-footnote font-semibold">{b.text!.content.split("\n")[0] || "…"}</span>
                  <span className="block text-caption-2 tabular-nums text-label-2">
                    {formatTimecode(b.start)}–{formatTimecode(b.end)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </FieldRow>
      )}
      {selected ? (
        <TextInspector key={selected.id} banner={selected} />
      ) : (
        <EmptyState className="!py-4" title="" text={t(texts.length ? "text.selectHint" : "text.emptyHint")} />
      )}
    </div>
  );
}

function TextInspector({ banner }: { banner: Banner }) {
  const spec = banner.text!;
  const catalog = useFontCatalog();
  const aspect = useEditor((s) => s.doc!.aspect);
  const begin = useEditor((s) => s.beginGesture);
  const end = useEditor((s) => s.endGesture);
  const asset = useAssets((s) => s.assets.find((a) => a.id === banner.assetId));
  const { height: H } = frameSize(aspect);
  const [draft, setDraft] = useState(spec.content);
  const timer = useRef<number | undefined>(undefined);
  const fam = catalog.find((f) => f.id === spec.font);

  useEffect(() => () => clearTimeout(timer.current), []);
  const style = (patch: Partial<TextSpec>) => void restyleText(banner.id, patch);

  return (
    <div className="space-y-1 border-t-[0.5px] border-separator pt-2">
      <FieldRow label={t("text.content")}>
        <textarea
          value={draft}
          rows={2}
          maxLength={1000}
          placeholder={t("text.placeholder")}
          aria-label={t("text.content")}
          onFocus={begin}
          onBlur={() => {
            clearTimeout(timer.current);
            if (draft !== spec.content) style({ content: draft });
            end();
          }}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            clearTimeout(timer.current);
            timer.current = window.setTimeout(() => style({ content: v }), 250);
          }}
          className="w-full resize-none rounded-[12px] bg-fill-2 px-3 py-2.5 text-body outline-none focus:ring-2 focus:ring-accent/60"
        />
      </FieldRow>

      <FieldRow label={t("text.presets")}>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label={t("text.presets")}>
          {TEXT_PRESETS.map((p) => {
            const look = { ...DEFAULT_TEXT, ...p.spec };
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={spec.preset === p.id}
                onClick={() => style({ ...p.spec, preset: p.id })}
                className={`flex h-14 shrink-0 items-center rounded-[12px] px-3 ${spec.preset === p.id ? "ring-2 ring-accent" : ""} bg-[#3a3a3c]`}
              >
                <span
                  className="rounded-[6px] px-1.5 text-headline font-black"
                  style={{
                    color: look.color,
                    background: look.box ? look.boxColor : "transparent",
                    opacity: 1,
                    WebkitTextStroke: look.outline ? `1.5px ${look.outlineColor}` : undefined,
                    textShadow: look.shadow ? "0 2px 6px rgba(0,0,0,.6)" : undefined,
                  }}
                >
                  {t(`text.presetNames.${p.id}`)}
                </span>
              </button>
            );
          })}
        </div>
      </FieldRow>

      <FieldRow label={t("subs.font")}>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label={t("subs.font")}>
          {catalog.map((f) => (
            <FontChip
              key={f.id}
              family={f}
              active={f.id === spec.font}
              onClick={() => style({ font: f.id, weight: resolveFace(catalog, f.id, spec.weight)!.weight, preset: "custom" })}
            />
          ))}
        </div>
      </FieldRow>
      {fam && fam.weights.length > 1 && (
        <FieldRow label={t("subs.weight")}>
          <SegmentedControl
            label={t("subs.weight")}
            value={resolveFace(catalog, spec.font, spec.weight)!.weight}
            onChange={(w) => style({ weight: w, preset: "custom" })}
            options={fam.weights.map((w) => ({ value: w.weight, label: t(`subs.weights.${w.weight}`) }))}
          />
        </FieldRow>
      )}
      <FieldRow label={t("subs.size")}>
        <Slider
          label={t("subs.size")}
          value={Math.round(textFontSize(banner, H))}
          min={16}
          max={300}
          step={1}
          format={(v) => `${Math.round(v)}`}
          onChangeStart={begin}
          onChangeEnd={end}
          onChange={(v) => resizeText(banner.id, v)}
        />
      </FieldRow>
      <FieldRow label={t("subs.color")}>
        <ColorSwatches label={t("subs.color")} value={spec.color} onChange={(c) => style({ color: c, preset: "custom" })} />
      </FieldRow>
      <FieldRow label={t("text.align")}>
        <SegmentedControl<TextSpec["align"]>
          label={t("text.align")}
          value={spec.align}
          onChange={(align) => style({ align })}
          options={[
            { value: "left", label: <AlignLeft size={17} />, ariaLabel: t("text.alignLeft") },
            { value: "center", label: <AlignCenter size={17} />, ariaLabel: t("text.alignCenter") },
            { value: "right", label: <AlignRight size={17} />, ariaLabel: t("text.alignRight") },
          ]}
        />
      </FieldRow>
      <FieldRow label={t("subs.outline")}>
        <Slider
          label={t("subs.outline")}
          value={spec.outline}
          min={0}
          max={0.25}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => style({ outline: v, preset: "custom" })}
        />
      </FieldRow>
      {spec.outline > 0 && (
        <FieldRow label={t("subs.outlineColor")}>
          <ColorSwatches label={t("subs.outlineColor")} value={spec.outlineColor} onChange={(c) => style({ outlineColor: c, preset: "custom" })} />
        </FieldRow>
      )}
      <ToggleRow label={t("text.shadow")} checked={spec.shadow} onChange={(v) => style({ shadow: v, preset: "custom" })} />
      <ToggleRow label={t("text.box")} checked={spec.box} onChange={(v) => style({ box: v, preset: "custom" })} />
      {spec.box && (
        <>
          <FieldRow label={t("text.boxColor")}>
            <ColorSwatches label={t("text.boxColor")} value={spec.boxColor} onChange={(c) => style({ boxColor: c, preset: "custom" })} />
          </FieldRow>
          <FieldRow label={t("text.boxOpacity")}>
            <Slider
              label={t("text.boxOpacity")}
              value={spec.boxOpacity}
              min={0.1}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => style({ boxOpacity: v, preset: "custom" })}
            />
          </FieldRow>
        </>
      )}
      <ToggleRow label={t("text.uppercase")} checked={spec.uppercase} onChange={(v) => style({ uppercase: v })} />

      <BannerInspector banner={banner} asset={asset} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between px-4">
      <span className="text-body">{label}</span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
