"use client";

/**
 * `useJobs` — React-hook som subscribar till jobQueue och returnerar
 * aktuell snapshot.
 *
 * `useJobsSummary` — mindre subset för status-badgen (running + queued
 * count + senaste fel).
 */

import { useEffect, useState } from "react";
import { jobQueue, type Job } from "./job-queue";

export function useJobs(): Job[] {
  const [jobs, setJobs] = useState<Job[]>(() => jobQueue.list());
  useEffect(() => jobQueue.subscribe(setJobs), []);
  return jobs;
}

export interface JobsSummary {
  total: number;
  queued: number;
  running: number;
  failed: number;
  /** Senaste error-meddelandet, eller null. */
  lastError: string | null;
}

export function useJobsSummary(): JobsSummary {
  const jobs = useJobs();
  const queued = jobs.filter((j) => j.status === "queued").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const lastFailed = jobs.find((j) => j.status === "failed");
  return {
    total: jobs.length,
    queued, running, failed,
    lastError: lastFailed?.error ?? null,
  };
}
