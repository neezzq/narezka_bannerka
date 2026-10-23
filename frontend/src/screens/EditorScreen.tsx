import { AlertTriangle, Crop, Captions, Image as ImageIcon, Pause, Play, Redo2, RotateCcw, Scissors, Trash2, Undo2, WandSparkles, Frame } from "lucide-react";
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
  type TabItem,
} from "@/components/ios";
import { t } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { formatTimecode } from "@/lib/timecode";
import type { Job } from "@/lib/types";
import { useAssets } from "@/store/assets";
import { flushSave, useEditor, type Tool } from "@/store/editor";
import { deleteSelectedCut, restoreCuts, splitAtPlayhead } from "@/editor/actions";
import { BannersPanel } from "@/editor/panels/BannersPanel";
import { ChromaPanel } from "@/editor/panels/ChromaPanel";
import { ExportSheet } from "@/editor/panels/ExportSheet";
import { FormatPanel } from "@/editor/panels/FormatPanel";
import { SubtitlesPanel, useTranscribe } from "@/editor/panels/SubtitlesPanel";
import { playback, usePlayer } from "@/editor/playback";
import { Preview } from "@/editor/Preview";
import { Timeline } from "@/editor/Timeline";

const TOOLS: TabItem<Tool>[] = [
  { key: "trim", label: t("editor.tools.trim"), icon: Scissors },
  { key: "subtitles", label: t("editor.tools.subtitles"), icon: Captions },
  { key: "banner", label: t("editor.tools.banner"), icon: ImageIcon },
  { key: "chroma", label: t("editor.tools.chroma"), icon: WandSparkles },
  { key: "format", label: t("editor.tools.format"), icon: Frame },
];

const PANEL_TITLES: Record<Exclude<Tool, "trim">, string> = {
  subtitles: t("subs.title"),
  banner: t("banner.title"),
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

function useMedia(query: string) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
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
                        alert((e as Error).message);
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
  const desktop = useMedia("(min-width: 1024px)");
  const panelTool = tool && tool !== "trim" ? tool : null;

  useEffect(() => {
    if (exportJob) setExportOpen(true);
  }, [exportJob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      {panelTool === "chroma" && <ChromaPanel />}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <NavBar
        title={meta.title}
        subtitle={<span className={saveState === "error" ? "text-danger" : ""}>{saveLabel}</span>}
        left={<NavBack label="Проекты" onClick={() => nav("/")} />}
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
            <Timeline />
          </div>
          <div ref={tabRef} className="relative z-[55] shrink-0">
            <TabBar items={TOOLS} active={tool} onChange={(k) => setTool(tool === k ? null : k)} />
          </div>
        </div>
        {desktop && (
          <aside className="flex w-[400px] shrink-0 flex-col border-l-[0.5px] border-separator bg-surface">
            {panelTool ? (
              <Sheet inline open onClose={() => setTool(null)} title={PANEL_TITLES[panelTool]}>
                {panel}
              </Sheet>
            ) : (
              <EmptyState className="m-auto" icon={<Crop size={40} strokeWidth={1.4} />} title="Инструменты" text="Выберите инструмент на панели снизу: субтитры, баннер, хромакей или формат кадра." />
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

function Transport() {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => Math.floor(s.time * 10) / 10);
  const duration = usePlayer((s) => s.duration);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-2">
      <IconButton label={playing ? t("editor.pause") : t("editor.play")} tone="label" onClick={() => playback.toggle()}>
        {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
      </IconButton>
      <span className="text-footnote tabular-nums">
        {formatTimecode(time, true)} <span className="text-label-3">/ {formatTimecode(duration, true)}</span>
      </span>
      <span className="flex-1" />
      {tool !== "trim" && (
        <>
          <IconButton label={t("editor.undo")} disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
            <Undo2 size={21} />
          </IconButton>
          <IconButton label={t("editor.redo")} disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
            <Redo2 size={21} />
          </IconButton>
        </>
      )}
      {tool === "trim" && (
        <>
          <Button variant="gray" size="sm" icon={<Scissors size={15} />} onClick={splitAtPlayhead}>
            {t("trim.split")}
          </Button>
          <Button variant="destructive" size="sm" icon={<Trash2 size={15} />} disabled={selection?.kind !== "cut"} onClick={deleteSelectedCut}>
            {t("common.delete")}
          </Button>
          <IconButton label={t("editor.undo")} disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
            <Undo2 size={21} />
          </IconButton>
          <IconButton label={t("trim.restore")} onClick={restoreCuts}>
            <RotateCcw size={19} />
          </IconButton>
        </>
      )}
    </div>
  );
}
