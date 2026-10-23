// Render jobs keep running on the server when the user leaves the export sheet
// (or closes the app). We remember them and show a push-like toast when done.
import { create } from "zustand";
import { watchJob } from "@/lib/jobs";
import type { Job, RenderResult } from "@/lib/types";

const KEY = "bk-render-jobs";

interface Tracked {
  jobId: string;
  projectId: string;
  title: string;
}

interface State {
  jobs: Record<string, Job<RenderResult>>;
  /** job currently shown in an open export sheet (no toast for it) */
  viewing: string | null;
  tracked: Tracked[];
  track: (t: Tracked) => void;
  forget: (jobId: string) => void;
  onFinished?: (t: Tracked, job: Job<RenderResult>) => void;
}

function load(): Tracked[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(list: Tracked[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

const watchers = new Map<string, () => void>();

export const useRenderJobs = create<State>((set, get) => ({
  jobs: {},
  viewing: null,
  tracked: load(),
  track: (t) => {
    const list = [...get().tracked.filter((x) => x.jobId !== t.jobId), t].slice(-10);
    save(list);
    set({ tracked: list });
    follow(t);
  },
  forget: (jobId) => {
    watchers.get(jobId)?.();
    watchers.delete(jobId);
    const list = get().tracked.filter((x) => x.jobId !== jobId);
    save(list);
    set({ tracked: list });
  },
}));

function follow(t: Tracked) {
  if (watchers.has(t.jobId)) return;
  const stop = watchJob(t.jobId, (job) => {
    useRenderJobs.setState((s) => ({ jobs: { ...s.jobs, [t.jobId]: job as Job<RenderResult> } }));
    if (job.status === "done" || job.status === "error" || job.status === "canceled") {
      watchers.get(t.jobId)?.();
      watchers.delete(t.jobId);
      const st = useRenderJobs.getState();
      const list = st.tracked.filter((x) => x.jobId !== t.jobId);
      save(list);
      useRenderJobs.setState({ tracked: list });
      st.onFinished?.(t, job as Job<RenderResult>);
    }
  });
  watchers.set(t.jobId, stop);
}

/** Resume watching jobs remembered from a previous visit. */
export function resumeRenderJobs(onFinished: State["onFinished"]) {
  useRenderJobs.setState({ onFinished });
  for (const t of useRenderJobs.getState().tracked) follow(t);
}
