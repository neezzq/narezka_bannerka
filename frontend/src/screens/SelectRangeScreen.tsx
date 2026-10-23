import { AlertTriangle, ArrowLeftToLine, ArrowRightToLine } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PlatformIcon } from "@/components/PlatformIcon";
import { ActivityIndicator, Button, EmptyState, NavBack, NavBar, ProgressBar } from "@/components/ios";
import { t } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { waitJob } from "@/lib/jobs";
import { formatDuration, formatTimecode } from "@/lib/timecode";
import type { PreviewResult, SourceInfo, Sprite } from "@/lib/types";
import { OverviewBar, RangeSlider } from "@/select/RangeSlider";
import { TimecodeField } from "@/select/TimecodeField";
import { TwitchPlayer, VideoPlayer, YouTubePlayer, type PlayerHandle } from "@/select/players";
import { useApp } from "@/store/app";

const WINDOW = 600; // seconds shown on the slider for long videos

interface UploadInfo {
  uploadId: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  jobId: string;
}

type Source =
  | { kind: "remote"; info: SourceInfo }
  | { kind: "upload"; info: UploadInfo };

function loadUpload(id: string): UploadInfo | null {
  try {
    return JSON.parse(sessionStorage.getItem(`bk-upload-${id}`) || "null");
  } catch {
    return null;
  }
}

export default function SelectRangeScreen() {
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const limit = useApp((s) => s.config.maxClipSeconds);
  const [source, setSource] = useState<Source | null>(() => {
    const st = loc.state as { source?: SourceInfo; upload?: UploadInfo } | null;
    if (st?.source) return { kind: "remote", info: st.source };
    if (st?.upload) return { kind: "upload", info: st.upload };
    const up = params.get("upload");
    const info = up ? loadUpload(up) : null;
    return info ? { kind: "upload", info } : null;
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [windowStart, setWindowStart] = useState(0);
  const [current, setCurrent] = useState<number | null>(null);
  const [tcError, setTcError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [strip, setStrip] = useState<{ key: string; sprites: Sprite[] } | null>(null);
  const player = useRef<PlayerHandle>(null);

  // resolve on reload (/new?url=...)
  useEffect(() => {
    if (source) return;
    const url = params.get("url");
    if (!url) {
      setLoadError(t("home.invalid"));
      return;
    }
    api
      .resolve(url)
      .then((info) => setSource({ kind: "remote", info }))
      .catch((e: ApiError) => setLoadError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const duration = source ? (source.kind === "remote" ? source.info.duration || preview?.duration || 0 : source.info.duration) : 0;
  const needsPreview = source?.kind === "upload" || (source?.kind === "remote" && source.info.player.type === "video");

  // server-side preview for platforms without a player API, and for uploads
  useEffect(() => {
    if (!source || !needsPreview) return;
    let alive = true;
    const run = async () => {
      try {
        let result: PreviewResult | undefined;
        if (source.kind === "upload") {
          result = (await waitJob<PreviewResult>(source.info.jobId, (j) => alive && setPreviewProgress(j.progress))).result!;
        } else {
          const r = await api.preview(source.info.url);
          result = r.result ?? (await waitJob<PreviewResult>(r.jobId!, (j) => alive && setPreviewProgress(j.progress))).result!;
        }
        if (alive) setPreview(result);
      } catch (e) {
        if (alive) setLoadError((e as Error).message || t("select.previewFailed"));
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [source, needsPreview]);

  // initial selection
  useEffect(() => {
    if (!source || range || duration <= 0) return;
    const hint = source.kind === "remote" ? source.info.startHint : 0;
    const len = duration <= limit ? duration - hint : Math.min(limit, 60);
    const s = Math.max(0, Math.min(hint, duration - 1));
    const e = Math.min(duration, s + Math.max(1, len));
    setRange([s, e]);
    setWindowStart(duration > WINDOW ? Math.max(0, Math.min(duration - WINDOW, s - WINDOW / 4)) : 0);
  }, [source, duration, limit, range]);

  // poll the player position for the marker
  useEffect(() => {
    const id = window.setInterval(() => {
      const ct = player.current?.getCurrentTime();
      if (typeof ct === "number" && !Number.isNaN(ct)) setCurrent(ct);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const windowLen = Math.min(duration, WINDOW);
  const ws = duration > WINDOW ? windowStart : 0;
  const we = ws + windowLen;

  const ensureVisible = useCallback(
    (s: number, e: number) => {
      if (duration <= WINDOW) return;
      if (s < ws || e > we) setWindowStart(Math.max(0, Math.min(duration - WINDOW, s - (WINDOW - (e - s)) / 2)));
    },
    [duration, ws, we],
  );

  // thumbnails for the slider window
  const stripKey = `${Math.round(ws)}-${Math.round(we)}`;
  useEffect(() => {
    if (!source || source.kind !== "remote" || source.info.platform !== "twitch" || source.info.player.type !== "twitch") return;
    if (duration <= 0 || strip?.key === stripKey) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const { jobId } = await api.strip(source.info.url, ws, we, 12);
        const job = await waitJob<{ sprite: Sprite }>(jobId);
        if (alive) setStrip({ key: stripKey, sprites: [job.result!.sprite] });
      } catch {
        if (alive) setStrip({ key: stripKey, sprites: [] });
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [source, stripKey, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const sprites: Sprite[] = useMemo(() => {
    if (!source) return [];
    if (preview) return [preview.sprite];
    if (source.kind === "remote" && source.info.storyboard.length) return source.info.storyboard;
    if (strip?.key === stripKey) return strip.sprites;
    return [];
  }, [source, preview, strip, stripKey]);
  const spritesLoading =
    !!source && source.kind === "remote" && source.info.platform === "twitch" && source.info.player.type === "twitch" && strip?.key !== stripKey;

  const setBoth = (s: number, e: number) => {
    const ss = Math.max(0, Math.min(s, duration));
    const ee = Math.max(ss + 0.1, Math.min(e, duration));
    setRange([ss, ee]);
    ensureVisible(ss, ee);
  };

  const len = range ? range[1] - range[0] : 0;
  const tooLong = len > limit + 0.05;
  const tooShort = len < 0.5;

  const create = async () => {
    if (!range || !source || tooLong || tooShort) return;
    setCreating(true);
    setCreateError(null);
    try {
      const body =
        source.kind === "remote"
          ? { url: source.info.url, start: range[0], end: range[1], title: source.info.title }
          : { uploadId: source.info.uploadId, start: range[0], end: range[1], title: source.info.title };
      const { project } = await api.createProject(body);
      nav(`/p/${project.id}`, { replace: true });
    } catch (e) {
      setCreateError((e as Error).message);
      setCreating(false);
    }
  };

  const title = source ? (source.kind === "remote" ? source.info.title : source.info.title) : "";
  const platform = source ? (source.kind === "remote" ? source.info.platform : "upload") : null;
  const aspect = source && source.info.width && source.info.height ? source.info.width / source.info.height : 16 / 9;

  let playerEl: React.ReactNode = null;
  if (source?.kind === "remote" && source.info.player.type === "youtube") {
    playerEl = <YouTubePlayer ref={player} videoId={source.info.player.id} start={range?.[0] ?? source.info.startHint} />;
  } else if (source?.kind === "remote" && source.info.player.type === "twitch") {
    playerEl = <TwitchPlayer ref={player} videoId={source.info.player.id} start={range?.[0] ?? source.info.startHint} />;
  } else if (preview) {
    playerEl = <VideoPlayer ref={player} src={preview.videoUrl} />;
  } else if (needsPreview) {
    playerEl = (
      <div className="flex size-full flex-col items-center justify-center gap-3 bg-black px-10 text-footnote text-label-2">
        <ActivityIndicator size={28} />
        {t("select.preparingPreview")}
        <ProgressBar value={previewProgress} className="w-40" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <NavBar title={t("select.title")} left={<NavBack label={t("common.back")} onClick={() => nav("/")} />} />
      {loadError ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<AlertTriangle size={44} strokeWidth={1.5} className="text-warning" />}
            title={t("common.error")}
            text={loadError}
            action={<Button onClick={() => nav("/")}>{t("app.toHome")}</Button>}
          />
        </div>
      ) : !source ? (
        <div className="flex flex-1 items-center justify-center">
          <ActivityIndicator size={32} />
        </div>
      ) : (
        <main className="scroll-y min-h-0 flex-1 pb-[calc(var(--safe-bottom)+16px)]">
          <div className="mx-auto w-full max-w-[640px]">
            <div className="bg-black" style={{ aspectRatio: String(Math.max(9 / 16, Math.min(16 / 9, aspect))), maxHeight: "48vh", margin: "0 auto" }}>
              {playerEl}
            </div>
            <div className="flex items-center gap-2 px-4 pt-3">
              <PlatformIcon platform={platform} size={18} />
              <h2 className="min-w-0 flex-1 truncate text-headline font-semibold">{title}</h2>
              {duration > 0 && <span className="shrink-0 text-footnote tabular-nums text-label-2">{formatTimecode(duration)}</span>}
            </div>

            {range && duration > 0 && (
              <div className="px-5 pt-4">
                {duration > WINDOW && (
                  <div className="mb-2">
                    <div className="mb-0.5 text-caption-1 text-label-2">{t("select.window")}</div>
                    <OverviewBar duration={duration} windowStart={ws} windowLen={windowLen} start={range[0]} end={range[1]} onWindow={setWindowStart} />
                  </div>
                )}
                <RangeSlider
                  windowStart={ws}
                  windowEnd={we}
                  duration={duration}
                  start={range[0]}
                  end={range[1]}
                  maxLen={limit}
                  current={current}
                  sprites={sprites}
                  spritesLoading={spritesLoading}
                  onChange={(s, e) => setRange([s, e])}
                  onSeek={(tt) => {
                    player.current?.seekTo(tt);
                    setCurrent(tt);
                  }}
                />

                <div className="mt-4 flex gap-2">
                  <TimecodeField
                    label={t("select.start")}
                    value={range[0]}
                    invalid={!!tcError}
                    onError={setTcError}
                    onCommit={(v) => setBoth(v, Math.max(range[1], v + 0.5))}
                    onRange={setBoth}
                  />
                  <TimecodeField
                    label={t("select.end")}
                    value={range[1]}
                    invalid={!!tcError || tooLong}
                    onError={setTcError}
                    onCommit={(v) => setBoth(Math.min(range[0], v - 0.5), v)}
                    onRange={setBoth}
                  />
                </div>
                <p className="mt-1.5 px-1 text-caption-1 text-label-3">{t("select.pasteHint")}</p>
                {tcError && (
                  <p role="alert" className="mt-1 px-1 text-footnote text-danger">
                    {tcError}
                  </p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    variant="gray"
                    size="md"
                    icon={<ArrowLeftToLine size={18} />}
                    onClick={() => {
                      const c = player.current?.getCurrentTime() ?? 0;
                      setBoth(c, c < range[1] && range[1] - c <= limit ? range[1] : Math.min(duration, c + Math.min(limit, len || 30)));
                    }}
                  >
                    {t("select.setStart")}
                  </Button>
                  <Button
                    variant="gray"
                    size="md"
                    icon={<ArrowRightToLine size={18} />}
                    onClick={() => {
                      const c = player.current?.getCurrentTime() ?? 0;
                      setBoth(c > range[0] && c - range[0] <= limit ? range[0] : Math.max(0, c - Math.min(limit, len || 30)), c);
                    }}
                  >
                    {t("select.setEnd")}
                  </Button>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-[12px] bg-surface px-4 py-3">
                  <div>
                    <div className="text-caption-1 text-label-2">{t("select.duration")}</div>
                    <div className={`text-title-3 font-semibold tabular-nums ${tooLong ? "text-danger" : ""}`}>{formatDuration(len)}</div>
                  </div>
                  <div className={`text-right text-footnote ${tooLong ? "text-danger" : "text-label-2"}`}>
                    {tooLong
                      ? t("select.tooLong", { limit: formatTimecode(limit) })
                      : tooShort
                        ? t("select.tooShort")
                        : t("select.limit", { limit: formatTimecode(limit) })}
                  </div>
                </div>

                {createError && (
                  <p role="alert" className="mt-3 px-1 text-footnote text-danger">
                    {createError}
                  </p>
                )}
                <Button size="lg" full className="mt-4" loading={creating} disabled={tooLong || tooShort} onClick={create}>
                  {creating ? t("select.creating") : t("common.next")}
                </Button>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
