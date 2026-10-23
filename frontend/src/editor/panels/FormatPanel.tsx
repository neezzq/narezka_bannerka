import { Maximize, Minimize, RotateCcw } from "lucide-react";
import { Button, ColorSwatches, FieldRow, SegmentedControl, Slider } from "@/components/ios";
import { t } from "@/i18n";
import type { Aspect } from "@/lib/types";
import { useEditor } from "@/store/editor";
import { setAspect } from "../actions";

const ASPECTS: { value: Aspect; w: number; h: number; label: string }[] = [
  { value: "9:16", w: 18, h: 32, label: "Reels, Shorts" },
  { value: "16:9", w: 32, h: 18, label: "YouTube" },
  { value: "1:1", w: 26, h: 26, label: "Квадрат" },
  { value: "4:5", w: 24, h: 30, label: "Лента" },
];

export function FormatPanel() {
  const aspect = useEditor((s) => s.doc!.aspect);
  const vt = useEditor((s) => s.doc!.videoTransform);
  const bg = useEditor((s) => s.doc!.background);
  const update = useEditor((s) => s.update);
  const begin = useEditor((s) => s.beginGesture);
  const end = useEditor((s) => s.endGesture);

  return (
    <div className="space-y-2 pb-4">
      <FieldRow label={t("format.aspect")}>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t("format.aspect")}>
          {ASPECTS.map((a) => {
            const sel = a.value === aspect;
            return (
              <button
                key={a.value}
                type="button"
                role="radio"
                aria-checked={sel}
                onClick={() => setAspect(a.value)}
                className={`flex h-[88px] flex-col items-center justify-center gap-1.5 rounded-[12px] ${sel ? "bg-accent/15 text-accent-text ring-2 ring-accent" : "bg-fill-2 text-label"}`}
              >
                <span className={`rounded-[4px] border-2 ${sel ? "border-accent" : "border-label-2"}`} style={{ width: a.w, height: a.h }} />
                <span className="text-footnote font-semibold">{a.value}</span>
                <span className="text-caption-2 text-label-2">{a.label}</span>
              </button>
            );
          })}
        </div>
      </FieldRow>
      <FieldRow label={t("format.fit")}>
        <SegmentedControl
          label={t("format.fit")}
          value={vt.fit}
          onChange={(fit) =>
            update((d) => {
              d.videoTransform = { fit, scale: 1, x: 0, y: 0 };
            })
          }
          options={[
            { value: "cover", label: <><Maximize size={14} /> {t("format.cover")}</> },
            { value: "contain", label: <><Minimize size={14} /> {t("format.contain")}</> },
          ]}
        />
      </FieldRow>
      <FieldRow label={t("format.scale")}>
        <Slider
          label={t("format.scale")}
          value={vt.scale}
          min={0.5}
          max={3}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChangeStart={begin}
          onChangeEnd={end}
          onChange={(v) =>
            update((d) => {
              d.videoTransform.scale = v;
            })
          }
        />
      </FieldRow>
      <div className="px-4">
        <Button
          variant="gray"
          size="sm"
          icon={<RotateCcw size={15} />}
          disabled={vt.scale === 1 && vt.x === 0 && vt.y === 0}
          onClick={() =>
            update((d) => {
              d.videoTransform = { ...d.videoTransform, scale: 1, x: 0, y: 0 };
            })
          }
        >
          {t("format.resetTransform")}
        </Button>
        <p className="mt-2 text-footnote text-label-2">{t("format.hint")}</p>
      </div>
      <FieldRow label={t("format.background")}>
        <ColorSwatches
          label={t("format.background")}
          value={bg}
          colors={["#000000", "#121214", "#FFFFFF", "#A6E22E", "#1C1C1E", "#0A84FF", "#FF453A", "#FFE600"]}
          onChange={(c) =>
            update((d) => {
              d.background = c;
            })
          }
        />
      </FieldRow>
    </div>
  );
}
