import { animate, motion, useMotionValue } from "framer-motion";
import { ClipboardPaste, Clapperboard, Download, Link2, Settings, Trash2, Upload, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { InstallPrompt } from "@/components/InstallPrompt";
import { PlatformIcon } from "@/components/PlatformIcon";
import {
  ActivityIndicator,
  Button,
  confirmDialog,
  EmptyState,
  IconButton,
  ListRow,
  ListSection,
  NavBar,
  ProgressBar,
  SegmentedControl,
  Sheet,
  Skeleton,
  toast,
} from "@/components/ios";
import { t } from "@/i18n";
import { api, ApiError, uploadSource } from "@/lib/api";
import { detectPlatform, isStandalone } from "@/lib/platform";
import { formatDuration } from "@/lib/timecode";
import type { ProjectSummary } from "@/lib/types";
import { DESKTOP, useMedia } from "@/lib/useMedia";
import { useApp, type Theme } from "@/store/app";

export function rememberUpload(info: object & { uploadId: string }) {
  try {
    sessionStorage.setItem(`bk-upload-${info.uploadId}`, JSON.stringify(info));
  } catch {
    /* ignore */
  }
}

export function HomeScreen() {
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ progress: number; abort: () => void } | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [settings, setSettings] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const config = useApp((s) => s.config);
  const online = useApp((s) => s.online);
  const platform = detectPlatform(text);
  const wide = useMedia(DESKTOP);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listProjects()
      .then((r) => alive && setProjects(r.projects))
      .catch(() => alive && setProjects((p) => p ?? []));
    return () => {
      alive = false;
    };
  }, [online]);

  const submit = async (value = text) => {
    const v = value.trim();
    if (!v) {
      inputRef.current?.focus();
      return;
    }
    if (!detectPlatform(v)) {
      setError(t("home.invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const source = await api.resolve(v);
      nav(`/new?url=${encodeURIComponent(source.url)}`, { state: { source } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        toast({ title: t("home.pasteEmpty"), tone: "info" });
        return;
      }
      setText(clip.trim());
      setError(null);
      if (detectPlatform(clip)) submit(clip);
    } catch {
      toast({ title: t("home.pasteDenied"), tone: "info" });
      inputRef.current?.focus();
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file || upload) return;
    if (file.size > config.maxUploadMb * 1024 * 1024) {
      toast({ title: t("errors.uploadSize", { mb: config.maxUploadMb }), tone: "error" });
      return;
    }
    const job = uploadSource(file, (p) => setUpload((u) => (u ? { ...u, progress: p } : u)));
    setUpload({ progress: 0, abort: job.abort });
    job.promise
      .then((info) => {
        rememberUpload(info);
        nav(`/new?upload=${info.uploadId}`, { state: { upload: info } });
      })
      .catch((e: ApiError) => {
        if (e.code !== "aborted") toast({ title: e.message, tone: "error" });
      })
      .finally(() => setUpload(null));
  };

  // drop a video anywhere on the window to upload it
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
      if (file) onFileRef.current(file);
      else toast({ title: t("home.dropNotVideo"), tone: "error" });
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  const remove = async (p: ProjectSummary) => {
    const ok = await confirmDialog({
      title: t("home.deleteTitle"),
      message: t("home.deleteText"),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
    api.deleteProject(p.id).catch((e) => toast({ title: e.message, tone: "error" }));
  };

  return (
    <div className="flex h-full flex-col">
      <NavBar
        large
        largeClassName="lg:mx-auto lg:max-w-[1184px] lg:px-8"
        title={t("home.title")}
        subtitle={t("app.tagline")}
        right={
          <IconButton label={t("home.settings")} onClick={() => setSettings(true)}>
            <Settings size={22} />
          </IconButton>
        }
      />
      <main className="scroll-y min-h-0 flex-1 pb-[calc(var(--safe-bottom)+24px)]">
        <div className="mx-auto w-full max-w-[560px] lg:grid lg:max-w-[1184px] lg:grid-cols-[440px_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:px-4">
          <div className="lg:sticky lg:top-0">
            {!online && (
              <div className="mx-4 mt-3 flex items-start gap-3 rounded-[var(--radius-card)] bg-warning/15 p-4" role="status">
                <WifiOff size={22} className="mt-0.5 shrink-0 text-warning" />
                <div>
                  <div className="text-headline">{t("app.offline")}</div>
                  <div className="text-footnote text-label-2">{t("app.offlineHint")}</div>
                </div>
              </div>
            )}
            <section className="px-4 pt-3">
              <div className="rounded-[var(--radius-card)] bg-surface p-4">
                <p className="mb-3 text-subhead text-label-2">{t("home.subtitle")}</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <label className="flex h-12 items-center gap-2.5 rounded-[12px] bg-fill-2 px-3 focus-within:ring-2 focus-within:ring-accent/60">
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      {platform ? <PlatformIcon platform={platform} /> : <Link2 size={20} className="text-label-3" />}
                    </span>
                    <input
                      ref={inputRef}
                      value={text}
                      onChange={(e) => {
                        setText(e.target.value);
                        setError(null);
                      }}
                      inputMode="url"
                      type="url"
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="go"
                      placeholder={t("home.placeholder")}
                      aria-label={t("home.placeholder")}
                      aria-invalid={!!error}
                      className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-label-3"
                    />
                    {text && (
                      <button
                        type="button"
                        aria-label={t("a11y.clear")}
                        onClick={() => {
                          setText("");
                          setError(null);
                          inputRef.current?.focus();
                        }}
                        className="flex size-8 items-center justify-center"
                      >
                        <span className="flex size-[18px] items-center justify-center rounded-full bg-label-3">
                          <X size={12} strokeWidth={3} className="text-bg" />
                        </span>
                      </button>
                    )}
                  </label>
                  {error && (
                    <p role="alert" className="mt-2 px-1 text-footnote text-danger">
                      {error}
                    </p>
                  )}
                  <div className="mt-3">
                    {text.trim() ? (
                      <Button type="submit" full loading={busy}>
                        {t("home.continue")}
                      </Button>
                    ) : (
                      <Button variant="tinted" full icon={<ClipboardPaste size={18} />} onClick={paste}>
                        {t("home.paste")}
                      </Button>
                    )}
                  </div>
                </form>
                <div className="mt-4 flex items-center gap-3 text-footnote text-label-3">
                  <span className="h-px flex-1 bg-separator" />
                  {t("home.or")}
                  <span className="h-px flex-1 bg-separator" />
                </div>
                {upload ? (
                  <div className="mt-3 rounded-[12px] bg-fill-2 px-3 py-3">
                    <div className="mb-2 flex items-center justify-between text-subhead">
                      <span className="flex items-center gap-2">
                        <ActivityIndicator size={16} />
                        {t("home.uploading", { percent: Math.round(upload.progress * 100) })}
                      </span>
                      <button type="button" className="text-accent-text" onClick={upload.abort}>
                        {t("common.cancel")}
                      </button>
                    </div>
                    <ProgressBar value={upload.progress} />
                  </div>
                ) : (
                  <Button variant="gray" full className="mt-3" icon={<Upload size={18} />} onClick={() => fileRef.current?.click()}>
                    {t("home.upload")}
                  </Button>
                )}
                {wide && !upload && <p className="mt-2 text-center text-caption-1 text-label-3">{t("home.dropHint")}</p>}
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/*"
                  className="hidden"
                  onChange={(e) => {
                    onFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <div className="mt-4 flex flex-wrap items-center gap-2 text-footnote text-label-2">
                  <span>{t("home.supported")}:</span>
                  {(["youtube", "twitch", "tiktok"] as const).map((p) => (
                    <span key={p} className="flex items-center gap-1.5 rounded-full bg-fill-2 py-1 pr-2.5 pl-1.5">
                      <PlatformIcon platform={p} size={16} /> {t(`platform.${p}`)}
                    </span>
                  ))}
                </div>
              </div>
            </section>
            {wide && <p className="mx-8 mt-6 text-center text-caption-1 text-label-3">{t("home.rights")}</p>}
          </div>

          {wide && projects?.length ? (
            <ProjectGrid projects={projects} onOpen={(p) => nav(`/p/${p.id}`)} onDelete={remove} />
          ) : (
            <ListSection header={t("home.recent")} className="mt-7 lg:mt-3">
              {projects === null &&
                [0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <Skeleton className="h-14 w-11" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              {projects?.length === 0 && (
                <EmptyState
                  className="!py-8"
                  icon={<Clapperboard size={40} strokeWidth={1.4} />}
                  title={t("home.noProjects")}
                  text={t("home.noProjectsHint")}
                />
              )}
              {projects?.map((p) => (
                <SwipeRow key={p.id} onDelete={() => remove(p)}>
                  <ListRow
                    onClick={() => nav(`/p/${p.id}`)}
                    chevron
                    icon={
                      <span className="relative flex h-14 w-11 items-center justify-center overflow-hidden rounded-md bg-surface-2">
                        {p.posterUrl ? (
                          <img src={p.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
                        ) : (
                          <PlatformIcon platform={p.platform} />
                        )}
                      </span>
                    }
                    title={p.title || t("home.untitled")}
                    subtitle={
                      <span className="flex items-center gap-1.5">
                        <PlatformIcon platform={p.platform} size={13} />
                        {formatDuration(p.duration)} · {p.aspect} ·{" "}
                        <span className={p.status === "error" ? "text-danger" : p.status === "downloading" ? "text-warning" : ""}>
                          {t(`home.status.${p.status}`)}
                        </span>
                      </span>
                    }
                  />
                </SwipeRow>
              ))}
            </ListSection>
          )}

          {!wide && <p className="mx-8 mt-6 text-center text-caption-1 text-label-3">{t("home.rights")}</p>}
        </div>
      </main>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-backdrop p-8">
          <div className="flex h-full max-h-[420px] w-full max-w-[720px] flex-col items-center justify-center gap-3 rounded-[28px] border-2 border-dashed border-accent bg-surface/90 text-center">
            <Upload size={44} className="text-accent-text" aria-hidden />
            <div className="text-title-2 font-semibold">{t("home.dropTitle")}</div>
            <div className="text-subhead text-label-2">{t("home.dropText", { mb: config.maxUploadMb })}</div>
          </div>
        </div>
      )}
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
      <InstallPrompt />
    </div>
  );
}

/** Desktop: recent projects as poster cards. */
function ProjectGrid({
  projects,
  onOpen,
  onDelete,
}: {
  projects: ProjectSummary[];
  onOpen: (p: ProjectSummary) => void;
  onDelete: (p: ProjectSummary) => void;
}) {
  return (
    <section className="mt-3" aria-label={t("home.recent")}>
      <h2 className="mb-2 px-4 text-footnote tracking-wide text-label-2 uppercase">{t("home.recent")}</h2>
      <ul className="grid grid-cols-2 gap-4 px-4 xl:grid-cols-3">
        {projects.map((p) => (
          <li key={p.id} className="group relative">
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="block w-full cursor-pointer overflow-hidden rounded-[var(--radius-card)] bg-surface text-left transition-transform hover:-translate-y-0.5"
            >
              <span className="flex aspect-video items-center justify-center overflow-hidden bg-surface-2">
                {p.posterUrl ? (
                  <img src={p.posterUrl} alt="" className="size-full object-contain" loading="lazy" />
                ) : (
                  <PlatformIcon platform={p.platform} size={28} />
                )}
              </span>
              <span className="block px-3 py-2.5">
                <span className="block truncate text-subhead font-semibold">{p.title || t("home.untitled")}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-caption-1 text-label-2">
                  <PlatformIcon platform={p.platform} size={13} />
                  <span className="min-w-0 truncate">
                    {formatDuration(p.duration)} · {p.aspect} ·{" "}
                    <span className={p.status === "error" ? "text-danger" : p.status === "downloading" ? "text-warning" : ""}>
                      {t(`home.status.${p.status}`)}
                    </span>
                  </span>
                </span>
              </span>
            </button>
            <IconButton
              label={t("common.delete")}
              tone="glass"
              size={34}
              className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onDelete(p)}
            >
              <Trash2 size={16} />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** iOS swipe-to-delete row. */
function SwipeRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const x = useMotionValue(0);
  const W = 88;
  return (
    <div className="relative overflow-hidden">
      <button
        type="button"
        onClick={() => {
          animate(x, 0);
          onDelete();
        }}
        className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center bg-danger text-white"
        aria-label={t("common.delete")}
      >
        <Trash2 size={22} />
      </button>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -W, right: 0 }}
        dragElastic={{ left: 0.2, right: 0 }}
        style={{ x }}
        onDragEnd={(_, info) => animate(x, info.offset.x < -W / 2 || info.velocity.x < -400 ? -W : 0, { type: "spring", stiffness: 500, damping: 40 })}
        className="relative bg-surface"
      >
        {children}
      </motion.div>
    </div>
  );
}

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  return (
    <Sheet open={open} onClose={onClose} title={t("home.settings")} modal detents={["medium"]}>
      <div className="space-y-6 py-3">
        <ListSection header={t("home.theme")}>
          <div className="p-3">
            <SegmentedControl<Theme>
              label={t("home.theme")}
              value={theme}
              onChange={setTheme}
              options={[
                { value: "dark", label: t("home.themeDark") },
                { value: "light", label: t("home.themeLight") },
                { value: "system", label: t("home.themeSystem") },
              ]}
            />
          </div>
        </ListSection>
        {!isStandalone() && (
          <ListSection footer={t("install.text")}>
            <ListRow
              icon={<Download size={20} className="text-accent-text" />}
              title={t("home.install")}
              onClick={() => {
                try {
                  localStorage.removeItem("bk-install-dismissed");
                } catch {
                  /* ignore */
                }
                location.reload();
              }}
            />
          </ListSection>
        )}
        <p className="px-8 text-center text-caption-1 text-label-3">{t("home.version")} · {t("home.rights")}</p>
      </div>
    </Sheet>
  );
}
