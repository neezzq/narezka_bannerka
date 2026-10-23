import { Captions, Merge, Minus, Plus, RefreshCw, Scissors, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import {
  ActivityIndicator,
  Button,
  ColorSwatches,
  confirmDialog,
  EmptyState,
  FieldRow,
  ProgressBar,
  SegmentedControl,
  Slider,
  Stepper,
  toast,
  Toggle,
} from "@/components/ios";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { ensureFont, resolveFace } from "@/lib/fonts";
import { watchJob } from "@/lib/jobs";
import {
  deleteLine,
  editLineText,
  lineSpan,
  lineText,
  mergeWithNext,
  POSITION_PRESETS,
  presetStyle,
  shiftLine,
  splitLine,
  SUBTITLE_PRESETS,
  wordIndexAtCaret,
} from "@/lib/subtitles";
import { formatTimecode } from "@/lib/timecode";
import { mapInterval } from "@/lib/timeline";
import type { Job, Line, SubtitleStyle } from "@/lib/types";
import { useApp } from "@/store/app";
import { useEditor } from "@/store/editor";
import { playback, usePlayer } from "../playback";
import { useFontCatalog } from "../subtitles/SubtitleCanvas";

// --------------------------------------------------------------- transcription job (survives panel close)
interface TranscribeState {
  job: Job | null;
  start: (projectId: string, language: string) => Promise<void>;
  resume: (job: Job) => void;
}

let stopWatch: (() => void) | null = null;

export const useTranscribe = create<TranscribeState>((set) => {
  const follow = (job: Job) => {
    stopWatch?.();
    set({ job });
    stopWatch = watchJob(job.id, (j) => {
      set({ job: j });
      if (j.status === "done" && j.result) {
        const st = useEditor.getState();
        if (st.meta?.id === j.projectId) {
          st.update((d) => {
            d.subtitles.words = j.result.words;
            d.subtitles.lines = j.result.lines;
            d.subtitles.enabled = true;
          });
        }
        toast({ title: t("subs.title"), message: `${j.result.words.length} слов распознано`, tone: "success" });
      } else if (j.status === "error") {
        toast({ title: t("subs.title"), message: j.error ?? t("errors.jobFailed"), tone: "error" });
      }
    });
  };
  return {
    job: null,
    start: async (projectId, language) => {
      const { job } = await api.transcribe(projectId, language);
      follow(job);
    },
    resume: follow,
  };
});

export function SubtitlesPanel() {
  const subs = useEditor((s) => s.doc!.subtitles);
  const update = useEditor((s) => s.update);
  const [tab, setTab] = useState<"text" | "style">("text");
  const job = useTranscribe((s) => s.job);
  const running = job && (job.status === "queued" || job.status === "running") && job.projectId === useEditor.getState().meta?.id;
  const hasLines = subs.lines.length > 0;

  return (
    <div className="pb-6">
      {running ? (
        <TranscribeProgress job={job!} />
      ) : !hasLines && !subs.words.length ? (
        <GenerateBlock />
      ) : null}
      {(hasLines || subs.words.length > 0) && !running && (
        <div className="sticky top-0 z-10 space-y-3 bg-inherit px-4 pt-1 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-body">{t("subs.show")}</span>
            <Toggle label={t("subs.show")} checked={subs.enabled} onChange={(v) => update((d) => void (d.subtitles.enabled = v))} />
          </div>
          <SegmentedControl
            label={t("subs.title")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "text", label: t("subs.text") },
              { value: "style", label: t("subs.style") },
            ]}
          />
        </div>
      )}
      {!running && (hasLines || subs.words.length > 0) && tab === "text" && <LinesEditor />}
      {!running && ((!hasLines && !subs.words.length) || tab === "style") && <StyleEditor />}
    </div>
  );
}

function GenerateBlock({ compact }: { compact?: boolean }) {
  const languages = useApp((s) => s.config.languages);
  const lang = useEditor((s) => s.doc!.subtitles.language);
  const update = useEditor((s) => s.update);
  const hasAudio = useEditor((s) => s.meta!.media!.hasAudio);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    const st = useEditor.getState();
    if (st.doc!.subtitles.lines.length) {
      const ok = await confirmDialog({ title: t("subs.regenerate"), message: t("subs.regenerateConfirm"), confirmText: t("subs.regenerate") });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await useTranscribe.getState().start(st.meta!.id, st.doc!.subtitles.language);
    } catch (e) {
      toast({ title: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const langOptions = languages.length ? languages : [{ code: "auto", name: "Авто" }, { code: "ru", name: "Русский" }, { code: "en", name: "English" }];
  return (
    <div className={compact ? "px-4 py-3" : ""}>
      {!compact && (
        <EmptyState className="!pt-4 !pb-2" icon={<Captions size={40} strokeWidth={1.4} />} title={t("subs.empty")} text={hasAudio ? t("subs.emptyHint") : "В видео нет звука."} />
      )}
      <div className="space-y-3 px-4">
        <FieldRow label={t("subs.language")}>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label={t("subs.language")}>
            {langOptions.map((l) => (
              <button
                key={l.code}
                type="button"
                role="radio"
                aria-checked={lang === l.code}
                onClick={() => update((d) => void (d.subtitles.language = l.code))}
                className={`h-9 shrink-0 rounded-full px-3.5 text-subhead font-medium ${lang === l.code ? "bg-accent text-on-accent" : "bg-fill-2"}`}
              >
                {l.name}
              </button>
            ))}
          </div>
        </FieldRow>
        <Button full size="lg" icon={<Wand2 size={18} />} loading={busy} disabled={!hasAudio} onClick={start}>
          {compact ? t("subs.regenerate") : t("subs.generate")}
        </Button>
      </div>
    </div>
  );
}

function TranscribeProgress({ job }: { job: Job }) {
  return (
    <div className="flex flex-col items-center px-8 py-8 text-center">
      <ActivityIndicator size={32} />
      <p className="mt-3 text-headline">{t(`subs.stages.${job.stage}`) !== `subs.stages.${job.stage}` ? t(`subs.stages.${job.stage}`) : t("subs.stages.recognize")}</p>
      <ProgressBar value={job.progress} className="mt-3 w-full max-w-64" />
      <p className="mt-2 text-footnote text-label-2">{Math.round(job.progress * 100)}%</p>
    </div>
  );
}

// --------------------------------------------------------------- lines

function LinesEditor() {
  const lines = useEditor((s) => s.doc!.subtitles.lines);
  const cuts = useEditor((s) => s.doc!.cuts);
  const selection = useEditor((s) => s.selection);
  const time = usePlayer((s) => Math.floor(s.time * 4) / 4);
  const listRef = useRef<HTMLDivElement>(null);
  const activeId = useMemo(() => {
    for (const l of lines) {
      if (!l.words.length) continue;
      const a = mapInterval(cuts, l.words[0].start, l.words[0].end);
      const b = mapInterval(cuts, l.words[l.words.length - 1].start, l.words[l.words.length - 1].end);
      if (a && b && time >= a[0] && time < b[1]) return l.id;
    }
    return null;
  }, [lines, cuts, time]);

  useEffect(() => {
    if (selection?.kind === "line") {
      listRef.current?.querySelector(`[data-line="${selection.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selection]);

  if (!lines.length) return <EmptyState title={t("subs.noLines")} action={<GenerateBlock compact />} />;
  return (
    <div ref={listRef} className="space-y-2 px-4">
      {lines.map((l, i) => (
        <LineCard key={l.id} line={l} last={i === lines.length - 1} active={l.id === activeId} selected={selection?.kind === "line" && selection.id === l.id} />
      ))}
      <div className="pt-4">
        <GenerateBlock compact />
      </div>
    </div>
  );
}

function LineCard({ line, last, active, selected }: { line: Line; last: boolean; active: boolean; selected: boolean }) {
  const update = useEditor((s) => s.update);
  const cuts = useEditor((s) => s.doc!.cuts);
  const [text, setText] = useState(lineText(line));
  const caret = useRef(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(lineText(line)), [line]);
  const [s, e] = lineSpan(line);
  const setLines = (fn: (ls: Line[]) => Line[]) => update((d) => void (d.subtitles.lines = fn(d.subtitles.lines as Line[])));

  const commit = () => {
    if (text.trim() === lineText(line)) return;
    if (!text.trim()) setLines((ls) => deleteLine(ls, line.id));
    else setLines((ls) => ls.map((x) => (x.id === line.id ? editLineText(x, text) : x)));
  };

  const seek = () => {
    const iv = mapInterval(cuts, s, e);
    if (iv) playback.seek(iv[0]);
    useEditor.getState().select({ kind: "line", id: line.id });
  };

  return (
    <div
      data-line={line.id}
      className={`rounded-[12px] bg-surface p-3 transition-shadow ${active ? "ring-2 ring-accent/70" : selected ? "ring-2 ring-label-3" : ""}`}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" onClick={seek} className="rounded-md bg-fill-2 px-2 py-0.5 text-caption-1 tabular-nums text-label-2">
          {formatTimecode(s, true)} – {formatTimecode(e, true)}
        </button>
        <div className="flex items-center">
          <SmallIcon label={`${t("subs.shift")} −0,1 с`} onClick={() => setLines((ls) => shiftLine(ls, line.id, -0.1))}>
            <Minus size={15} />
          </SmallIcon>
          <span className="px-0.5 text-caption-2 text-label-3">{t("subs.shift")}</span>
          <SmallIcon label={`${t("subs.shift")} +0,1 с`} onClick={() => setLines((ls) => shiftLine(ls, line.id, 0.1))}>
            <Plus size={15} />
          </SmallIcon>
        </div>
      </div>
      <textarea
        ref={ta}
        value={text}
        rows={Math.min(4, Math.max(1, Math.ceil(text.length / 34)))}
        onChange={(ev) => setText(ev.target.value)}
        onSelect={(ev) => (caret.current = (ev.target as HTMLTextAreaElement).selectionStart)}
        onFocus={seek}
        onBlur={commit}
        placeholder={t("subs.linePlaceholder")}
        aria-label={t("subs.linePlaceholder")}
        className="w-full resize-none bg-transparent text-body leading-snug outline-none"
      />
      <div className="mt-1 flex items-center gap-1 border-t-[0.5px] border-separator pt-1.5">
        <SmallAction
          icon={<Scissors size={15} />}
          label={t("subs.split")}
          onClick={() => {
            commit();
            const idx = wordIndexAtCaret(text, caret.current || Math.floor(text.length / 2));
            setLines((ls) => splitLine(ls, line.id, idx));
          }}
          disabled={line.words.length < 2}
        />
        <SmallAction icon={<Merge size={15} />} label={t("subs.merge")} onClick={() => setLines((ls) => mergeWithNext(ls, line.id))} disabled={last} />
        <span className="flex-1" />
        <SmallAction icon={<Trash2 size={15} />} label={t("subs.deleteLine")} danger onClick={() => setLines((ls) => deleteLine(ls, line.id))} />
      </div>
    </div>
  );
}

function SmallIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex size-9 items-center justify-center rounded-full text-accent-text active:bg-fill-2">
      {children}
    </button>
  );
}

function SmallAction({ icon, label, onClick, disabled, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex h-9 items-center gap-1.5 rounded-full px-2.5 text-footnote font-medium disabled:opacity-30 active:bg-fill-2 ${danger ? "text-danger" : "text-accent-text"}`}
    >
      {icon}
      <span className="max-[380px]:hidden">{label}</span>
    </button>
  );
}

// --------------------------------------------------------------- style

function PresetCard({ id, active, onClick }: { id: string; active: boolean; onClick: () => void }) {
  const st = presetStyle(id);
  const catalog = useFontCatalog();
  const face = catalog.length ? resolveFace(catalog, st.fontFamily, st.fontWeight) : null;
  const [, force] = useState(0);
  useEffect(() => {
    if (face) ensureFont(face).then(() => force((x) => x + 1));
  }, [face]);
  const sample = st.uppercase ? "ПРИВЕТ МИР" : "Привет мир";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-[84px] w-[118px] shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[12px] bg-[#3a3a3c] bg-[linear-gradient(135deg,#4a4a4f,#2c2c2e)] ${active ? "ring-2 ring-accent" : ""}`}
    >
      <span
        style={{
          fontFamily: face ? `"${face.internalName}"` : undefined,
          fontSize: 17,
          color: st.color,
          WebkitTextStroke: st.outlineWidth ? `${Math.min(3, st.outlineWidth / 3)}px ${st.outlineColor}` : undefined,
          paintOrder: "stroke fill",
          background: st.box.enabled ? st.box.color : undefined,
          padding: st.box.enabled ? "1px 6px" : undefined,
          borderRadius: st.box.enabled ? 6 : undefined,
          textShadow: st.shadowOpacity ? `1px 1px 0 rgba(0,0,0,${st.shadowOpacity})` : undefined,
        }}
        className="whitespace-nowrap"
      >
        {sample.split(" ")[0]} <span style={{ color: st.karaoke ? st.highlightColor : st.color }}>{sample.split(" ")[1]}</span>
      </span>
      <span className="text-caption-2 font-medium text-white/80">{t(`subs.presetNames.${id}`)}</span>
    </button>
  );
}

function StyleEditor() {
  const style = useEditor((s) => s.doc!.subtitles.style);
  const update = useEditor((s) => s.update);
  const begin = useEditor((s) => s.beginGesture);
  const end = useEditor((s) => s.endGesture);
  const catalog = useFontCatalog();
  const set = (fn: (s: SubtitleStyle) => void) => update((d) => fn(d.subtitles.style as SubtitleStyle));
  const fam = catalog.find((f) => f.id === style.fontFamily);
  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    apply: (s: SubtitleStyle, v: number) => void,
    format?: (v: number) => string,
  ) => (
    <FieldRow label={label}>
      <Slider
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        format={format ?? ((v) => String(Math.round(v)))}
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(v) => set((s) => apply(s, v))}
      />
    </FieldRow>
  );

  return (
    <div className="space-y-1">
      <FieldRow label={t("subs.presets")}>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {SUBTITLE_PRESETS.map((p) => (
            <PresetCard
              key={p.id}
              id={p.id}
              active={style.preset === p.id}
              onClick={() =>
                update((d) => {
                  const keepPos = d.subtitles.style.position.preset === "custom" && p.style.position.preset !== "custom";
                  const next = presetStyle(p.id);
                  if (keepPos) next.position = d.subtitles.style.position;
                  d.subtitles.style = next;
                })
              }
            />
          ))}
        </div>
      </FieldRow>

      <FieldRow label={t("subs.font")}>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label={t("subs.font")}>
          {catalog.map((f) => (
            <FontChip
              key={f.id}
              family={f}
              active={f.id === style.fontFamily}
              onClick={() =>
                set((s) => {
                  s.fontFamily = f.id;
                  s.fontWeight = resolveFace(catalog, f.id, s.fontWeight)!.weight;
                  s.preset = "custom";
                })
              }
            />
          ))}
        </div>
      </FieldRow>
      {fam && fam.weights.length > 1 && (
        <FieldRow label={t("subs.weight")}>
          <SegmentedControl
            label={t("subs.weight")}
            value={style.fontWeight}
            onChange={(w) => set((s) => void (s.fontWeight = w))}
            options={fam.weights.map((w) => ({ value: w.weight, label: { 400: "Обычный", 600: "Полужирный", 700: "Жирный", 800: "Очень жирный", 900: "Чёрный" }[w.weight] ?? String(w.weight) }))}
          />
        </FieldRow>
      )}
      {slider(t("subs.size"), style.fontSize, 24, 160, 1, (s, v) => void (s.fontSize = v))}
      <FieldRow label={t("subs.color")}>
        <ColorSwatches label={t("subs.color")} value={style.color} onChange={(c) => set((s) => void (s.color = c))} />
      </FieldRow>

      <ToggleRow label={t("subs.highlight")} checked={style.karaoke} onChange={(v) => set((s) => void (s.karaoke = v))} />
      {style.karaoke && (
        <FieldRow label={t("subs.highlightColor")}>
          <ColorSwatches label={t("subs.highlightColor")} value={style.highlightColor} onChange={(c) => set((s) => void (s.highlightColor = c))} />
        </FieldRow>
      )}
      <ToggleRow label={t("subs.wordPop")} checked={style.wordPop} onChange={(v) => set((s) => void (s.wordPop = v))} />

      {slider(t("subs.outline"), style.outlineWidth, 0, 20, 0.5, (s, v) => void (s.outlineWidth = v), (v) => `${v} px`)}
      {style.outlineWidth > 0 && (
        <FieldRow label={t("subs.outlineColor")}>
          <ColorSwatches label={t("subs.outlineColor")} value={style.outlineColor} onChange={(c) => set((s) => void (s.outlineColor = c))} />
        </FieldRow>
      )}
      {slider(t("subs.shadow"), style.shadowOpacity, 0, 1, 0.05, (s, v) => void (s.shadowOpacity = v), (v) => `${Math.round(v * 100)}%`)}
      {style.shadowOpacity > 0 && (
        <>
          {slider(t("subs.shadowOffset"), style.shadowOffset, 1, 20, 0.5, (s, v) => void (s.shadowOffset = v), (v) => `${v} px`)}
          <FieldRow label={t("subs.shadowColor")}>
            <ColorSwatches label={t("subs.shadowColor")} value={style.shadowColor} onChange={(c) => set((s) => void (s.shadowColor = c))} />
          </FieldRow>
        </>
      )}

      <ToggleRow label={t("subs.box")} checked={style.box.enabled} onChange={(v) => set((s) => void (s.box.enabled = v))} />
      {style.box.enabled && (
        <>
          <FieldRow label={t("subs.boxColor")}>
            <ColorSwatches label={t("subs.boxColor")} value={style.box.color} onChange={(c) => set((s) => void (s.box.color = c))} />
          </FieldRow>
          {slider(t("subs.boxOpacity"), style.box.opacity, 0.1, 1, 0.05, (s, v) => void (s.box.opacity = v), (v) => `${Math.round(v * 100)}%`)}
          {slider(t("subs.boxRadius"), style.box.radius, 0, 60, 1, (s, v) => void (s.box.radius = v), (v) => `${v} px`)}
          {slider(t("subs.boxPadding"), style.box.paddingX, 4, 80, 1, (s, v) => {
            s.box.paddingX = v;
            s.box.paddingY = Math.round(v * 0.45);
          }, (v) => `${v} px`)}
        </>
      )}

      <FieldRow label={t("subs.position")}>
        <SegmentedControl
          label={t("subs.position")}
          value={style.position.preset}
          onChange={(p) =>
            set((s) => {
              if (p === "custom") return;
              s.position = { preset: p, x: 0.5, y: POSITION_PRESETS[p] };
            })
          }
          options={[
            { value: "top", label: t("subs.top") },
            { value: "center", label: t("subs.center") },
            { value: "bottom", label: t("subs.bottom") },
            ...(style.position.preset === "custom" ? [{ value: "custom" as const, label: t("subs.custom") }] : []),
          ]}
        />
        <p className="mt-1.5 text-caption-1 text-label-3">{t("subs.dragHint")}</p>
      </FieldRow>
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-subhead text-label-2">{t("subs.words")}</span>
        <Stepper label={t("subs.words")} value={style.wordsPerScreen} min={1} max={10} onChange={(v) => set((s) => void (s.wordsPerScreen = v))} />
      </div>
      <FieldRow label={t("subs.case")}>
        <SegmentedControl
          label={t("subs.case")}
          value={style.uppercase ? "upper" : "as-is"}
          onChange={(v) => set((s) => void (s.uppercase = v === "upper"))}
          options={[
            { value: "as-is", label: t("subs.caseAsIs") },
            { value: "upper", label: t("subs.caseUpper") },
          ]}
        />
      </FieldRow>
      <FieldRow label={t("subs.animation")}>
        <SegmentedControl
          label={t("subs.animation")}
          value={style.animation}
          onChange={(v) => set((s) => void (s.animation = v))}
          options={[
            { value: "none", label: t("subs.animNone") },
            { value: "fade", label: t("subs.animFade") },
            { value: "pop", label: t("subs.animPop") },
            { value: "slide", label: t("subs.animSlide") },
          ]}
        />
      </FieldRow>
      <div className="px-4 pt-2">
        <Button variant="gray" size="sm" icon={<RefreshCw size={14} />} onClick={() => update((d) => void (d.subtitles.style = presetStyle(d.subtitles.style.preset)))}>
          {t("common.reset")}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between px-4 py-1">
      <span className="text-body">{label}</span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

function FontChip({ family, active, onClick }: { family: import("@/lib/fonts").FontFamily; active: boolean; onClick: () => void }) {
  const face = family.weights[Math.min(1, family.weights.length - 1)];
  const [, force] = useState(0);
  useEffect(() => {
    ensureFont(face).then(() => force((x) => x + 1));
  }, [face]);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex h-14 shrink-0 flex-col items-center justify-center rounded-[12px] px-3 ${active ? "bg-accent text-on-accent" : "bg-fill-2"}`}
    >
      <span style={{ fontFamily: `"${face.internalName}"`, fontSize: 19, lineHeight: 1.1 }}>Аа</span>
      <span className="text-caption-2">{family.name}</span>
    </button>
  );
}
