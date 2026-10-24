import { CheckCircle2, Download, Heart, RotateCcw, Share2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityIndicator, Button, ListRow, ListSection, ProgressRing, SegmentedControl, Sheet, toast } from "@/components/ios";
import { useSupport } from "@/components/SupportSheet";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { frameSize } from "@/lib/geometry";
import { formatBytes } from "@/lib/id";
import { useJob } from "@/lib/jobs";
import { EXPORT_SHORT_SIDE, exportQualities } from "@/lib/quality";
import { formatDuration } from "@/lib/timecode";
import { outputDuration } from "@/lib/timeline";
import type { ExportSettings, RenderResult } from "@/lib/types";
import { useRenderJobs } from "@/store/backgroundJobs";
import { flushSave, useEditor } from "@/store/editor";
import { waitTextUploads } from "../text/textBanners";

async function shareFile(r: RenderResult) {
  try {
    const blob = await (await fetch(r.mediaUrl)).blob();
    const file = new File([blob], r.name || "bannerka.mp4", { type: "video/mp4" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: r.name });
      return;
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
  }
  toast({ title: t("export.shareUnsupported"), tone: "info" });
}

export function ExportSheet({ open, onClose, initialJobId }: { open: boolean; onClose: () => void; initialJobId?: string | null }) {
  const doc = useEditor((s) => s.doc!);
  const meta = useEditor((s) => s.meta!);
  const update = useEditor((s) => s.update);
  const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);
  const [starting, setStarting] = useState(false);
  const job = useJob<RenderResult>(jobId);
  const settings = doc.export;
  const short = EXPORT_SHORT_SIDE[settings.quality];
  const qualities = exportQualities(meta.media?.width ?? 0, meta.media?.height ?? 0);
  if (!qualities.includes(settings.quality)) qualities.push(settings.quality);
  const { width, height } = frameSize(doc.aspect, short);

  useEffect(() => {
    if (initialJobId) setJobId(initialJobId);
  }, [initialJobId]);

  useEffect(() => {
    if (!open || !jobId) return;
    useRenderJobs.setState({ viewing: jobId });
    return () => useRenderJobs.setState({ viewing: null });
  }, [open, jobId]);

  // pick up a render that is still running for this project
  useEffect(() => {
    if (jobId || !open) return;
    const running = meta.jobs?.find((j) => j.kind === "render" && (j.status === "queued" || j.status === "running"));
    if (running) setJobId(running.id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setExport = (patch: Partial<ExportSettings>) => update((d) => void Object.assign(d.export, patch));

  const start = async () => {
    setStarting(true);
    try {
      await waitTextUploads(); // text images must be on the server before the render
      await flushSave();
      const { jobId: id } = await api.render(meta.id, useEditor.getState().doc!, settings);
      setJobId(id);
      useRenderJobs.getState().track({ jobId: id, projectId: meta.id, title: meta.title });
    } catch (e) {
      toast({ title: (e as Error).message, tone: "error" });
    } finally {
      setStarting(false);
    }
  };

  const running = job && (job.status === "queued" || job.status === "running");
  const done = job?.status === "done" ? job.result : null;

  return (
    <Sheet open={open} onClose={onClose} title={t("export.title")} detents={["large", "medium"]} detent="large" modal>
      <div className="space-y-6 py-3">
        {!job && (
          <>
            <ListSection header={t("export.quality")}>
              <div className="p-3">
                <SegmentedControl
                  label={t("export.quality")}
                  value={settings.quality}
                  onChange={(quality) => setExport({ quality })}
                  options={qualities.map((q) => ({ value: q, label: q === "2160p" ? "4K" : q }))}
                />
              </div>
            </ListSection>
            <ListSection header={t("export.fps")}>
              <div className="p-3">
                <SegmentedControl<string>
                  label={t("export.fps")}
                  value={String(settings.fps)}
                  onChange={(v) => setExport({ fps: v === "source" ? "source" : (Number(v) as 30 | 60) })}
                  options={[
                    { value: "source", label: `${t("export.source")}${meta.media ? ` (${Math.round(meta.media.fps)})` : ""}` },
                    { value: "30", label: "30" },
                    { value: "60", label: "60" },
                  ]}
                />
              </div>
            </ListSection>
            <ListSection>
              <ListRow title={t("export.format")} value={t("export.formatValue")} />
              <ListRow title={t("export.resolution")} value={`${width}×${height}`} />
              <ListRow title={t("export.duration")} value={formatDuration(outputDuration(doc.cuts))} />
            </ListSection>
            <div className="px-4">
              <Button size="lg" full loading={starting} onClick={start}>
                {t("export.start")}
              </Button>
            </div>
          </>
        )}

        {running && (
          <div className="flex flex-col items-center px-8 py-6 text-center">
            {job!.status === "queued" ? <ActivityIndicator size={40} /> : <ProgressRing value={job!.progress} size={96} label={t("export.rendering", { percent: Math.round(job!.progress * 100) })} />}
            <p className="mt-4 text-headline">{job!.status === "queued" ? t("export.queued") : t("export.rendering", { percent: Math.round(job!.progress * 100) })}</p>
            <p className="mt-1 text-footnote text-label-2">{t("export.backgroundHint")}</p>
            <Button variant="gray" size="sm" className="mt-4" onClick={() => api.cancelJob(job!.id).catch(() => undefined)}>
              {t("common.cancel")}
            </Button>
          </div>
        )}

        {done && (
          <div className="px-4">
            <div className="overflow-hidden rounded-[var(--radius-card)] bg-black">
              <video src={done.mediaUrl} controls playsInline className="mx-auto max-h-[46vh] w-auto" />
            </div>
            <div className="mt-3 flex items-center gap-2 text-headline">
              <CheckCircle2 className="text-accent" size={22} /> {t("export.ready")}
              <span className="ml-auto text-footnote text-label-2">
                {done.width}×{done.height} · {formatBytes(done.size)}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={done.url}
                download={done.name}
                className="inline-flex h-[50px] items-center justify-center gap-2 rounded-full bg-accent px-6 text-headline font-semibold text-on-accent active:opacity-80"
              >
                <Download size={18} aria-hidden />
                {t("common.download")}
              </a>
              <Button size="lg" variant="tinted" icon={<Share2 size={18} />} onClick={() => shareFile(done)}>
                {t("common.share")}
              </Button>
            </div>
            <Button variant="plain" full className="mt-2" icon={<RotateCcw size={16} />} onClick={() => setJobId(null)}>
              {t("export.again")}
            </Button>
            <button
              type="button"
              onClick={useSupport.getState().show}
              className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[12px] bg-accent/10 px-4 py-3 text-subhead font-semibold text-accent-text transition-colors hover:bg-accent/15"
            >
              <Heart size={16} aria-hidden /> {t("support.afterExport")}
            </button>
          </div>
        )}

        {job && (job.status === "error" || job.status === "canceled") && (
          <div className="flex flex-col items-center px-8 py-6 text-center">
            <XCircle size={44} className="text-danger" />
            <p className="mt-3 text-headline">{t("export.failed")}</p>
            {job.error && <p className="mt-1 text-footnote text-label-2">{job.error}</p>}
            <Button className="mt-4" onClick={() => setJobId(null)}>
              {t("common.retry")}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
