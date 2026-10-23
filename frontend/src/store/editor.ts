import { produce, type Draft } from "immer";
import { create } from "zustand";
import { api } from "@/lib/api";
import type { Project, ProjectDoc, ProjectMeta } from "@/lib/types";

const HISTORY_LIMIT = 100;
const SAVE_DEBOUNCE = 800;

export type Tool = "trim" | "subtitles" | "banner" | "chroma" | "format";
export type SaveState = "saved" | "dirty" | "saving" | "error";
export type Selection = { kind: "cut" | "banner" | "line"; id: string } | null;

const DOC_KEYS: (keyof ProjectDoc)[] = ["aspect", "background", "videoTransform", "cuts", "subtitles", "banners", "videoChroma", "export"];

export function splitProject(p: Project): { meta: ProjectMeta; doc: ProjectDoc } {
  const doc = {} as ProjectDoc;
  const meta = { ...p } as any;
  for (const k of DOC_KEYS) {
    (doc as any)[k] = p[k];
    delete meta[k];
  }
  return { meta, doc };
}

interface EditorState {
  meta: ProjectMeta | null;
  doc: ProjectDoc | null;
  past: ProjectDoc[];
  future: ProjectDoc[];
  gestureBase: ProjectDoc | null;
  saveState: SaveState;

  tool: Tool | null;
  selection: Selection;
  eyedropper: boolean;
  chromaTarget: string; // "video" or banner id

  load: (p: Project) => void;
  setMeta: (m: Partial<ProjectMeta>) => void;
  /** Apply a change. Inside a gesture, history is recorded once at endGesture. */
  update: (fn: (d: Draft<ProjectDoc>) => void, opts?: { history?: boolean }) => void;
  /** Replace the doc without recording history (e.g. server-side results merged in). */
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  setTool: (t: Tool | null) => void;
  select: (s: Selection) => void;
  setEyedropper: (v: boolean) => void;
  setChromaTarget: (id: string) => void;
  reset: () => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  meta: null,
  doc: null,
  past: [],
  future: [],
  gestureBase: null,
  saveState: "saved",
  tool: null,
  selection: null,
  eyedropper: false,
  chromaTarget: "video",

  load: (p) => {
    const { meta, doc } = splitProject(p);
    loading = true;
    set({ meta, doc, past: [], future: [], gestureBase: null, saveState: "saved" });
    loading = false;
  },
  setMeta: (m) => set((s) => ({ meta: s.meta ? { ...s.meta, ...m } : s.meta })),

  update: (fn, opts) => {
    const { doc, gestureBase, past } = get();
    if (!doc) return;
    const next = produce(doc, fn);
    if (next === doc) return;
    if (gestureBase || opts?.history === false) {
      set({ doc: next });
    } else {
      set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
    }
  },
  beginGesture: () => {
    const { doc, gestureBase } = get();
    if (doc && !gestureBase) set({ gestureBase: doc });
  },
  endGesture: () => {
    const { doc, gestureBase, past } = get();
    if (!gestureBase) return;
    if (doc && doc !== gestureBase) {
      set({ gestureBase: null, past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [] });
    } else {
      set({ gestureBase: null });
    }
  },
  undo: () => {
    const { doc, past, future } = get();
    if (!doc || !past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future].slice(0, HISTORY_LIMIT), gestureBase: null });
  },
  redo: () => {
    const { doc, past, future } = get();
    if (!doc || !future.length) return;
    set({ doc: future[0], future: future.slice(1), past: [...past, doc].slice(-HISTORY_LIMIT), gestureBase: null });
  },
  setTool: (tool) => set({ tool, eyedropper: false }),
  select: (selection) => set({ selection }),
  setEyedropper: (eyedropper) => set({ eyedropper }),
  setChromaTarget: (chromaTarget) => set({ chromaTarget }),
  reset: () => {
    cancelSave();
    set({ meta: null, doc: null, past: [], future: [], gestureBase: null, saveState: "saved", tool: null, selection: null, eyedropper: false });
  },
}));

// ------------------------------------------------------------------ autosave

let loading = false;
let timer: number | undefined;
let inflight: Promise<void> | null = null;
let pending = false;

function cancelSave() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  pending = false;
}

async function doSave(keepalive = false): Promise<void> {
  const { meta, doc } = useEditor.getState();
  if (!meta || !doc || meta.status !== "ready") return;
  if (inflight) {
    pending = true;
    return inflight;
  }
  pending = false;
  useEditor.setState({ saveState: "saving" });
  inflight = api
    .saveProject(meta.id, doc, undefined, keepalive)
    .then((r) => {
      const s = useEditor.getState();
      if (s.meta?.id === meta.id) {
        useEditor.setState({ saveState: s.doc === doc ? "saved" : "dirty", meta: { ...s.meta, revision: r.revision } });
      }
    })
    .catch(() => {
      useEditor.setState({ saveState: "error" });
      timer = window.setTimeout(() => doSave(), 5000);
    })
    .finally(() => {
      inflight = null;
      if (pending) doSave();
    });
  return inflight;
}

/** Save immediately (before export, when leaving the editor). */
export async function flushSave(keepalive = false): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  const s = useEditor.getState().saveState;
  if (s === "dirty" || s === "error") await doSave(keepalive);
  else if (inflight) await inflight;
}

useEditor.subscribe((s, prev) => {
  if (loading || !s.doc || s.doc === prev.doc || s.meta?.id !== prev.meta?.id) return;
  if (s.gestureBase) {
    // save after the gesture ends
    if (s.saveState !== "dirty") useEditor.setState({ saveState: "dirty" });
    return;
  }
  if (s.saveState !== "dirty") useEditor.setState({ saveState: "dirty" });
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => doSave(), SAVE_DEBOUNCE);
});

// gesture ended without further doc changes → still need to save
useEditor.subscribe((s, prev) => {
  if (prev.gestureBase && !s.gestureBase && s.saveState === "dirty") {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => doSave(), SAVE_DEBOUNCE);
  }
});

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave(true);
  });
  window.addEventListener("pagehide", () => flushSave(true));
}

export const useDoc = <T,>(sel: (d: ProjectDoc) => T): T => useEditor((s) => sel(s.doc as ProjectDoc));
