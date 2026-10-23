import { t } from "@/i18n";
import type {
  AppConfig,
  Asset,
  Job,
  ExportSettings,
  PreviewResult,
  Project,
  ProjectDoc,
  ProjectSummary,
  SourceInfo,
  Sprite,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string = "error",
    public status: number = 0,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(t("common.networkError"), "network", 0);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(err?.message || `${t("common.error")} (${res.status})`, err?.code || "http", res.status);
  }
  return data as T;
}

export const api = {
  config: () => request<AppConfig>("GET", "/api/config"),
  resolve: (url: string) => request<SourceInfo>("POST", "/api/source/resolve", { url }),
  preview: (url: string) =>
    request<{ jobId: string | null; result?: PreviewResult }>("POST", "/api/source/preview", { url }),
  strip: (url: string, start: number, end: number, count: number) =>
    request<{ jobId: string }>("POST", "/api/source/strip", { url, start, end, count }),

  listProjects: () => request<{ projects: ProjectSummary[] }>("GET", "/api/projects"),
  createProject: (body: { url?: string; uploadId?: string; start: number; end: number; title?: string }) =>
    request<{ project: Project; jobId: string }>("POST", "/api/projects", body),
  getProject: (id: string) => request<Project>("GET", `/api/projects/${id}`),
  saveProject: (id: string, doc: ProjectDoc, title?: string, keepalive = false) =>
    request<{ revision: number; updatedAt: string }>("PATCH", `/api/projects/${id}`, { doc, title }, { keepalive }),
  deleteProject: (id: string) => request<{ ok: boolean }>("DELETE", `/api/projects/${id}`),
  thumbnails: (id: string) => request<Sprite>("GET", `/api/projects/${id}/thumbnails`),
  transcribe: (id: string, language: string) =>
    request<{ jobId: string; job: Job }>("POST", `/api/projects/${id}/transcribe`, { language }),
  render: (id: string, doc: ProjectDoc, exportSettings: ExportSettings) =>
    request<{ jobId: string; job: Job }>("POST", `/api/projects/${id}/render`, { doc, export: exportSettings }),

  listAssets: () => request<{ assets: Asset[] }>("GET", "/api/assets"),
  getAsset: (id: string) => request<Asset>("GET", `/api/assets/${id}`),
  deleteAsset: (id: string) => request<{ ok: boolean }>("DELETE", `/api/assets/${id}`),

  job: (id: string) => request<Job>("GET", `/api/jobs/${id}`),
  jobs: (active = false) => request<{ jobs: Job[] }>("GET", `/api/jobs${active ? "?active=true" : ""}`),
  cancelJob: (id: string) => request<Job>("POST", `/api/jobs/${id}/cancel`),
};

/** multipart upload with progress (fetch has no upload progress events) */
export function uploadFile<T>(url: string, file: File, onProgress?: (fraction: number) => void): {
  promise: Promise<T>;
  abort: () => void;
} {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(t("common.networkError"), "network"));
    xhr.onabort = () => reject(new ApiError("aborted", "aborted"));
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(data?.error?.message || t("common.error"), data?.error?.code || "http", xhr.status));
    };
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export const uploadSource = (file: File, onProgress?: (f: number) => void) =>
  uploadFile<{ uploadId: string; title: string; duration: number; width: number; height: number; jobId: string }>(
    "/api/source/upload",
    file,
    onProgress,
  );

export const uploadAsset = (file: File, onProgress?: (f: number) => void) =>
  uploadFile<{ asset: Asset; jobId: string | null }>("/api/assets", file, onProgress);
