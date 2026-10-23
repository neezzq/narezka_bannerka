import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Job } from "./types";

export const isTerminal = (j: Pick<Job, "status"> | null | undefined) =>
  !!j && (j.status === "done" || j.status === "error" || j.status === "canceled");

/**
 * Follow a job via SSE (/api/jobs/:id/events) with polling fallback.
 * Returns an unsubscribe function.
 */
export function watchJob(jobId: string, onUpdate: (job: Job) => void): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let timer: number | undefined;
  let safety: number | undefined;
  let failures = 0;
  let lastKey = "";
  const emit = (job: Job) => {
    const key = `${job.status}|${job.stage}|${job.progress}`;
    if (key === lastKey) return;
    lastKey = key;
    onUpdate(job);
  };

  const poll = async () => {
    if (closed) return;
    try {
      const job = await api.job(jobId);
      failures = 0;
      emit(job);
      if (isTerminal(job)) return;
    } catch {
      failures++;
    }
    timer = window.setTimeout(poll, Math.min(5000, 1200 + failures * 800));
  };

  if (typeof EventSource !== "undefined") {
    es = new EventSource(`/api/jobs/${jobId}/events`);
    es.onmessage = (e) => {
      try {
        const job = JSON.parse(e.data) as Job;
        emit(job);
        if (isTerminal(job)) {
          es?.close();
          closed = true;
        }
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      // connection dropped (proxy, sleep, network): switch to polling
      es?.close();
      es = null;
      if (!closed) poll();
    };
    // safety net: some proxies/tunnels buffer SSE silently — check the status anyway
    safety = window.setInterval(async () => {
      if (closed) return;
      try {
        const job = await api.job(jobId);
        emit(job);
        if (isTerminal(job)) {
          closed = true;
          es?.close();
        }
      } catch {
        /* next tick */
      }
    }, 4000);
  } else {
    poll();
  }
  return () => {
    closed = true;
    es?.close();
    if (timer) clearTimeout(timer);
    if (safety) clearInterval(safety);
  };
}

export function useJob<R = any>(jobId: string | null | undefined, initial?: Job<R> | null): Job<R> | null {
  const [job, setJob] = useState<Job<R> | null>(initial ?? null);
  const idRef = useRef(jobId);
  idRef.current = jobId;
  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    return watchJob(jobId, (j) => {
      if (idRef.current === jobId) setJob(j as Job<R>);
    });
  }, [jobId]);
  return job && job.id === jobId ? job : null;
}

/** Promise that resolves when the job finishes successfully. */
export function waitJob<R = any>(jobId: string, onProgress?: (job: Job<R>) => void): Promise<Job<R>> {
  return new Promise((resolve, reject) => {
    const stop = watchJob(jobId, (j) => {
      onProgress?.(j as Job<R>);
      if (j.status === "done") {
        stop();
        resolve(j as Job<R>);
      } else if (j.status === "error" || j.status === "canceled") {
        stop();
        reject(new Error(j.error || "error"));
      }
    });
  });
}
