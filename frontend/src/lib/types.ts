// Project document — mirrors backend/app/schemas.py

export type Aspect = "9:16" | "16:9" | "1:1" | "4:5";
export type Fit = "contain" | "cover";
export type Platform = "youtube" | "twitch" | "tiktok" | "upload";
export type Anim = "none" | "fade" | "slide-left" | "slide-right" | "slide-up" | "slide-down" | "scale";

export interface Cut {
  id: string;
  start: number;
  end: number;
}

export interface VideoTransform {
  scale: number;
  x: number;
  y: number;
  fit: Fit;
}

export interface ChromaSettings {
  enabled: boolean;
  color: string;
  similarity: number;
  blend: number;
  spill: number;
}

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Line {
  id: string;
  words: Word[];
}

export interface BoxStyle {
  enabled: boolean;
  color: string;
  opacity: number;
  radius: number;
  paddingX: number;
  paddingY: number;
}

export interface SubtitleStyle {
  preset: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowOffset: number;
  box: BoxStyle;
  position: { preset: "top" | "center" | "bottom" | "custom"; x: number; y: number };
  wordsPerScreen: number;
  uppercase: boolean;
  animation: "none" | "fade" | "pop" | "slide";
  karaoke: boolean;
  wordPop: boolean;
}

export interface Subtitles {
  enabled: boolean;
  language: string;
  words: Word[];
  lines: Line[];
  style: SubtitleStyle;
}

export interface Banner {
  id: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  start: number;
  end: number;
  animIn: Anim;
  animOut: Anim;
  animDuration: number;
  chroma: ChromaSettings | null;
  /** set for text banners: the PNG is drawn from this spec in the browser */
  text?: TextSpec | null;
}

export interface TextSpec {
  content: string;
  preset: string;
  font: string;
  weight: number;
  color: string;
  align: "left" | "center" | "right";
  /** stroke width in font sizes */
  outline: number;
  outlineColor: string;
  shadow: boolean;
  box: boolean;
  boxColor: string;
  boxOpacity: number;
  uppercase: boolean;
  /** font px the PNG was drawn with and its height (keeps the size on re-render) */
  renderFont: number;
  renderHeight: number;
}

export interface ExportSettings {
  quality: "720p" | "1080p" | "1440p" | "2160p";
  fps: "source" | 30 | 60;
}

export interface ProjectDoc {
  aspect: Aspect;
  background: string;
  videoTransform: VideoTransform;
  cuts: Cut[];
  subtitles: Subtitles;
  banners: Banner[];
  videoChroma: ChromaSettings | null;
  export: ExportSettings;
}

export interface Sprite {
  url: string;
  columns: number;
  rows: number;
  count: number;
  start: number;
  interval: number;
  tileWidth: number;
  tileHeight: number;
}

export interface Media {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  proxyUrl: string;
  posterUrl: string;
  thumbnails: Sprite;
}

export interface ProjectMeta {
  id: string;
  title: string;
  platform: Platform;
  sourceUrl: string | null;
  sourceRange: { start: number; end: number };
  status: "downloading" | "ready" | "error";
  error: string | null;
  media: Media | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  jobs: Job[];
}

export type Project = ProjectMeta & ProjectDoc;

export interface ProjectSummary {
  id: string;
  title: string;
  platform: Platform;
  status: ProjectMeta["status"];
  duration: number;
  posterUrl: string | null;
  aspect: Aspect;
  updatedAt: string;
}

export interface GifMeta {
  frames: number[];
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
}

export interface Asset {
  id: string;
  kind: "image" | "gif" | "video";
  status: "processing" | "ready" | "error";
  error: string | null;
  name: string;
  width: number;
  height: number;
  duration: number | null;
  url: string | null;
  thumbUrl: string | null;
  gif: GifMeta | null;
  createdAt: string;
}

export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface Job<R = any> {
  id: string;
  kind: "download" | "preview" | "strip" | "transcribe" | "render" | "asset";
  projectId: string | null;
  status: JobStatus;
  progress: number;
  stage: string;
  error: string | null;
  result: R | null;
  createdAt: string;
}

export interface SourceInfo {
  platform: Exclude<Platform, "upload">;
  kind: string;
  id: string;
  url: string;
  title: string;
  uploader: string;
  duration: number;
  width: number;
  height: number;
  thumbnail: string | null;
  player: { type: "youtube" | "twitch"; id: string } | { type: "video" };
  startHint: number;
  storyboard: Sprite[];
  /** quality classes (short side) available for download, best first */
  qualities?: number[];
}

export interface PreviewResult {
  videoUrl: string;
  duration: number;
  width: number;
  height: number;
  sprite: Sprite;
}

export interface RenderResult {
  fileId: string;
  url: string;
  mediaUrl: string;
  size: number;
  width: number;
  height: number;
  duration: number;
  name: string;
}

export interface AppConfig {
  maxClipSeconds: number;
  maxBannerMb: number;
  maxUploadMb: number;
  defaultQuality?: number;
  maxQuality?: number;
  languages: { code: string; name: string }[];
}
