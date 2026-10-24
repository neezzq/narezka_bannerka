import { AlertTriangle, Captions, Image as ImageIcon, Keyboard, Pause, Play, Redo2, RotateCcw, Scissors, Trash2, Type, Undo2, WandSparkles, Frame } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ActivityIndicator,
  Button,
  EmptyState,
  IconButton,
  NavBack,
  NavBar,
  ProgressRing,
  Sheet,
  TabBar,
  toast,
  type TabItem,
} from "@/components/ios";
import { SupportButton } from "@/components/SupportSheet";
import { t } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { formatTimecode } from "@/lib/timecode";
import type { Job } from "@/lib/types";
import { DESKTOP, useMedia } from "@/lib/useMedia";
import { useAssets } from "@/store/assets";
import { flushSave, useEditor, type Tool } from "@/store/editor";
import { deleteSelectedCut, duplicateBanner, removeBanner, restoreCuts, splitAtPlayhead } from "@/editor/actions";
import { BannersPanel } from "@/editor/panels/BannersPanel";
import { ChromaPanel } from "@/editor/panels/ChromaPanel";
import { ExportSheet } from "@/editor/panels/ExportSheet";
import { FormatPanel } from "@/editor/panels/FormatPanel";
import { SubtitlesPanel, useTranscribe } from "@/editor/panels/SubtitlesPanel";
import { TextPanel } from "@/editor/panels/TextPanel";
import { playback, usePlayer } from "@/editor/playback";
import { Preview } from "@/editor/Preview";
import { Timeline } from "@/editor/Timeline";

const TOOLS: TabItem<Tool>[] = [
  { key: "trim", label: t("editor.tools.trim"), icon: Scissors },
  { key: "subtitles", label: t("editor.tools.subtitles"), icon: Captions },
  { key: "banner", label: t("editor.tools.banner"), icon: ImageIcon },
  { key: "text", label: t("editor.tools.text"), icon: Type },
  { key: "chroma", label: t("editor.tools.chroma"), icon: WandSparkles },
  { key: "format", label: t("editor.tools.format"), icon: Frame },
];

const PANEL_TITLES: Record<Exclude<Tool, "trim">, string> = {
  subtitles: t("subs.title"),
  banner: t("banner.title"),
  text: t("text.title"),
  chroma: t("chroma.title"),
  format: t("format.title"),
};

function useHeight<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return [ref, h];
}

/** Editor hotkeys (desktop first, harmless on phones with keyboards). */
function onEditorKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  if (el.closest("input, textarea, select, [contenteditable], [role='slider']")) return;
  if (document.querySelector("[aria-modal='true']")) return;
  const st = useEditor.getState();
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  const sel = st.selection;
  if (mod && (key === "z" || key === "y")) {
    e.preventDefault();
    if (e.shiftKey || key === "y") st.redo();
    else st.undo();
  } else if (mod && key === "d") {
    if (sel?.kind !== "banner") return;
    e.preventDefault();
    duplicateBanner(sel.id);
  } else if (mod || e.altKey) {
    return;
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const step = e.shiftKey ? 1 : 1 / (st.meta?.media?.fps || 30);
    playback.pause();
    playback.seek(usePlayer.getState().time + (e.key === "ArrowLeft" ? -step : step));
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    playback.pause();
    playback.seek(e.key === "Home" ? 0 : usePlayer.getState().duration);
  } else if (key === "s") {
    e.preventDefault();
    splitAtPlayhead();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    if (sel?.kind === "banner") removeBanner(sel.id);
    else if (sel?.kind === "cut") deleteSelectedCut();
    else return;
    e.preventDefault();
  } else if (e.key === "Escape") {
    if (st.eyedropper) st.setEyedropper(false);
    else if (sel) st.select(null);
    else if (st.tool) st.setTool(null);
  }
}

const HOTKEYS: [string, string][] = [
  [t("keys.space"), t("keys.play")],
  ["← →", t("keys.frame")],
  ["Shift + ← →", t("keys.second")],
  ["Home / End", t("keys.ends")],
  ["S", t("keys.split")],
  ["Delete", t("keys.delete")],
  ["⌘/Ctrl + Z", t("keys.undo")],
  ["⌘/Ctrl + Shift + Z", t("keys.redo")],
  ["⌘/Ctrl + D", t("keys.duplicate")],
  ["Esc", t("keys.escape")],
  [t("keys.wheelBanner"), t("keys.bannerSize")],
  [t("keys.wheel"), t("keys.scroll")],
  [`Ctrl + ${t("keys.wheel")}`, t("keys.zoom")],
];

function DesktopHelp() {
  return (
    <div className="scroll-y min-h-0 flex-1 px-5 py-6">
      <h2 className="text-title-3 font-semibold">{t("editor.toolsTitle")}</h2>
      <p className="mt-1 text-footnote text-label-2">{t("editor.toolsHintDesktop")}</p>
      <h3 className="mt-6 mb-2 flex items-center gap-2 text-footnote font-semibold tracking-wide text-label-2 uppercase">
        <Keyboard size={16} aria-hidden /> {t("keys.title")}
      </h3>
      <dl className="divide-y-[0.5px] divide-separator rounded-[12px] bg-surface-2">
        {HOTKEYS.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-footnote text-label-2">{v}</dt>
            <dd>
              <kbd className="rounded-[6px] bg-fill-2 px-1.5 py-0.5 font-sans text-caption-1 whitespace-nowrap text-label">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
      <SupportButton size="md" className="mt-6 w-full" />
    </div>
  );
}

function ToolRail({ active, onChange }: { active: Tool | null; onChange: (k: Tool) => void }) {
  return (
    <nav
      aria-label={t("a11y.tools")}
      aria-orientation="vertical"
      role="tablist"
      className="flex w-[88px] shrink-0 flex-col gap-1 border-l-[0.5px] border-separator bg-bg py-2"
    >
      {TOOLS.map(({ key, label, icon: Icon }) => {
        const selected = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(key)}
            className={`mx-1.5 flex cursor-pointer flex-col items-center gap-1 rounded-[10px] py-2.5 text-caption-2 font-medium transition-colors ${
              selected ? "bg-accent/15 text-accent-text" : "text-label-2 hover:bg-fill-2 hover:text-label"
            }`}
          >
            <Icon size={22} strokeWidth={selected ? 2 : 1.6} aria-hidden />
            <span className="max-w-full truncate px-1">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function EditorScreen() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const meta = useEditor((s) => s.meta);
  const doc = useEditor((s) => s.doc);
  const load = useEditor((s) => s.load);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);

  const fetchProject = useCallback(async () => {
    try {
      const p = await api.getProject(id!);
      load(p);
      setError(null);
      const tr = p.jobs.find((j) => j.kind === "transcribe" && (j.status === "queued" || j.status === "running"));
      if (tr) useTranscribe.getState().resume(tr);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.status === 404 ? t("editor.expired") : err.message, code: err.code });
    }
  }, [id, load]);

  useEffect(() => {
    useEditor.getState().reset();
    usePlayer.setState({ time: 0, playing: false });
    fetchProject();
    useAssets.getState().load();
    return () => {
      flushSave();
      playback.pause();
      useEditor.getState().reset();
    };
  }, [fetchProject]);

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <NavBar title={t("editor.title")} left={<NavBack label={t("common.back")} onClick={() => nav("/")} />} />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<AlertTriangle size={44} strokeWidth={1.5} className="text-warning" />}
            title={t("editor.loadError")}
            text={error.message}
            action={
              <div className="flex gap-2">
                <Button variant="gray" onClick={() => nav("/")}>
                  {t("app.toHome")}
                </Button>
                {error.code === "network" && <Button onClick={fetchProject}>{t("common.retry")}</Button>}
              </div>
            }
          />
        </div>
      </div>
    );
  }
  if (!meta || meta.id !== id) {
    return (
      <div className="flex h-full items-center justify-center">
        <ActivityIndicator size={32} />
      </div>
    );
  }
  if (meta.status !== "ready" || !meta.media || !doc) {
    return <PreparingView onReady={fetchProject} />;
  }
  return <Editor exportJob={params.get("export")} clearExportParam={() => setParams({}, { replace: true })} />;
}

// ------------------------------------------------------------------ download progress

function PreparingView({ onReady }: { onReady: () => void }) {
  const nav = useNavigate();
  const meta = useEditor((s) => s.meta!);
  const initial = meta.jobs.find((j) => j.kind === "download") ?? null;
  const job = useJob(initial?.id, initial as Job | null);
  const failed = meta.status === "error" || job?.status === "error" || job?.status === "canceled";

  useEffect(() => {
    if (job?.status === "done") onReady();
  }, [job?.status, onReady]);

  const stageKey = job ? `download.${job.stage}` : "download.queued";
  const stage = t(stageKey) === stageKey ? t("download.download") : t(stageKey);

  return (
    <div className="flex h-full flex-col">
      <NavBar title={meta.title} left={<NavBack label={t("common.back")} onClick={() => nav("/")} />} />
      <div className="flex flex-1 items-center justify-center p-6">
        {failed ? (
          <EmptyState
            icon={<AlertTriangle size={44} strokeWidth={1.5} className="text-warning" />}
            title={t("download.failed")}
            text={job?.error || meta.error || undefined}
            action={
              <div className="flex gap-2">
                <Button variant="gray" onClick={() => nav("/")}>
                  {t("app.toHome")}
                </Button>
                {meta.sourceUrl && (
                  <Button
                    onClick={async () => {
                      try {
                        const { project } = await api.createProject({ url: meta.sourceUrl!, start: meta.sourceRange.start, end: meta.sourceRange.end, title: meta.title });
                        nav(`/p/${project.id}`, { replace: true });
                      } catch (e) {
                        toast({ title: (e as Error).message, tone: "error" });
                      }
                    }}
                  >
                    {t("common.retry")}
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <div className="w-full max-w-sm rounded-[var(--radius-card)] bg-surface p-6 text-center">
            <h2 className="text-title-3 font-semibold">{t("download.title")}</h2>
            <p className="mt-1 text-footnote text-label-2">
              {formatTimecode(meta.sourceRange.start)} – {formatTimecode(meta.sourceRange.end)}
            </p>
            <div className="my-6 flex justify-center">
              <ProgressRing value={job?.progress ?? 0} size={104} label={stage} />
            </div>
            <p className="text-headline">{job?.status === "queued" ? t("download.queued") : stage}</p>
            <p className="mt-2 text-footnote text-label-2">{t("download.hint")}</p>
            {job && (
              <Button variant="gray" size="sm" className="mt-5" onClick={() => api.cancelJob(job.id).then(() => nav("/")).catch(() => undefined)}>
                {t("download.cancel")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editor

function Editor({ exportJob, clearExportParam }: { exportJob: string | null; clearExportParam: () => void }) {
  const nav = useNavigate();
  const meta = useEditor((s) => s.meta!);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const saveState = useEditor((s) => s.saveState);
  const [exportOpen, setExportOpen] = useState(!!exportJob);
  const [sheetH, setSheetH] = useState(0);
  const desktop = useMedia(DESKTOP);
  const panelTool = tool && tool !== "trim" ? tool : null;

  useEffect(() => {
    if (exportJob) setExportOpen(true);
  }, [exportJob]);

  useEffect(() => {
    window.addEventListener("keydown", onEditorKey);
    return () => window.removeEventListener("keydown", onEditorKey);
  }, []);

  const saveLabel = { saved: t("editor.saved"), dirty: t("editor.saving"), saving: t("editor.saving"), error: t("editor.saveError") }[saveState];
  const [stackRef, stackH] = useHeight<HTMLDivElement>();
  const [tabRef, tabH] = useHeight<HTMLDivElement>();
  // the sheet docks above the tab bar and covers the timeline; shrink the preview so it stays visible
  const inset = !desktop && panelTool ? Math.max(0, sheetH - stackH) : 0;

  const panel = panelTool && (
    <>
      {panelTool === "format" && <FormatPanel />}
      {panelTool === "subtitles" && <SubtitlesPanel />}
      {panelTool === "banner" && <BannersPanel />}
      {panelTool === "text" && <TextPanel />}
      {panelTool === "chroma" && <ChromaPanel />}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <NavBar
        title={meta.title}
        subtitle={<span className={saveState === "error" ? "text-danger" : ""}>{saveLabel}</span>}
        left={<NavBack label={t("editor.projects")} onClick={() => nav("/")} />}
        right={
          <Button size="sm" onClick={() => setExportOpen(true)} className="mr-1.5">
            {t("editor.export")}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Preview bottomInset={inset} />
          <div ref={stackRef} className="shrink-0">
            <Transport />
            <Timeline large={desktop} />
          </div>
          <div ref={tabRef} className={`relative z-[55] shrink-0 ${desktop ? "hidden" : ""}`}>
            <TabBar items={TOOLS} active={tool} onChange={(k) => setTool(tool === k ? null : k)} />
          </div>
        </div>
        {desktop && <ToolRail active={tool} onChange={(k) => setTool(tool === k ? null : k)} />}
        {desktop && (
          <aside className="flex w-[380px] shrink-0 flex-col border-l-[0.5px] border-separator bg-surface">
            {panelTool ? (
              <Sheet inline open onClose={() => setTool(null)} title={PANEL_TITLES[panelTool]}>
                {panel}
              </Sheet>
            ) : (
              <DesktopHelp />
            )}
          </aside>
        )}
      </div>
      {!desktop && (
        <Sheet
          open={!!panelTool}
          onClose={() => setTool(null)}
          title={panelTool ? PANEL_TITLES[panelTool] : ""}
          onHeightChange={setSheetH}
          detent="medium"
          bottomOffset={tabH}
        >
          {panel}
        </Sheet>
      )}
      <ExportSheet
        open={exportOpen}
        initialJobId={exportJob}
        onClose={() => {
          setExportOpen(false);
          clearExportParam();
        }}
      />
    </div>
  );
}

/** Desktop seek bar: the obvious way to pick a moment with a mouse. */
function SeekBar() {
  const time = usePlayer((s) => Math.round(s.time * 20) / 20);
  const duration = usePlayer((s) => s.duration);
  return (
    <input
      type="range"
      min={0}
      max={duration || 0}
      step={0.01}
      value={Math.min(time, duration)}
      aria-label={t("editor.seek")}
      onPointerDown={() => usePlayer.getState().playing && playback.pause()}
      onChange={(e) => playback.seek(Number(e.target.value))}
      className="mx-3 h-1.5 min-w-0 flex-1 cursor-pointer"
      style={{ accentColor: "var(--color-accent)" }}
    />
  );
}

function Transport() {
  const desktop = useMedia(DESKTOP);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => Math.floor(s.time * 10) / 10);
  const duration = usePlayer((s) => s.duration);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <IconButton label={playing ? t("editor.pause") : t("editor.play")} tone="label" onClick={() => playback.toggle()}>
          {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </IconButton>
        <span className="whitespace-nowrap text-footnote tabular-nums">
          {formatTimecode(time, true)} <span className="text-label-3">/ {formatTimecode(duration, true)}</span>
        </span>
        {desktop ? <SeekBar /> : <span className="flex-1" />}
        <IconButton label={t("editor.undo")} disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
          <Undo2 size={21} />
        </IconButton>
        <IconButton label={t("editor.redo")} disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
          <Redo2 size={21} />
        </IconButton>
      </div>
      {tool === "trim" && (
        <div className="flex h-11 shrink-0 items-center justify-center gap-2 px-3" role="toolbar" aria-label={t("editor.tools.trim")}>
          <Button variant="gray" size="sm" icon={<Scissors size={15} />} onClick={splitAtPlayhead}>
            {t("trim.split")}
          </Button>
          <Button variant="destructive" size="sm" icon={<Trash2 size={15} />} disabled={selection?.kind !== "cut"} onClick={deleteSelectedCut}>
            {t("trim.delete")}
          </Button>
          <Button variant="plain" size="sm" icon={<RotateCcw size={15} />} onClick={restoreCuts}>
            {t("trim.restore")}
          </Button>
        </div>
      )}
    </>
  );
}
