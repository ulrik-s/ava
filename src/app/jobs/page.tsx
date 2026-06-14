"use client";

/**
 * `/jobs` — översikt av alla klient-side jobb (aktiva, köade,
 * färdiga, misslyckade). Cancel/Retry per rad. Rensa-historik-knapp.
 */

import { X, RotateCcw, Trash2 } from "lucide-react";
import { jobQueue, type Job } from "@/lib/client/jobs/job-queue";
import { useJobs } from "@/lib/client/jobs/use-jobs";

export default function JobsPage() {
  const jobs = useJobs();
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const finished = jobs.filter((j) => j.status === "done" || j.status === "failed" || j.status === "canceled");

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Jobbkö</h1>
        <p className="text-sm text-gray-500 mt-1">
          Bakgrundsarbete som körs i din webbläsare: dokumentanalys,
          indexering och liknande. Inget skickas till någon server.
        </p>
      </div>

      <Section title="Aktiva" jobs={active} emptyText="Inga aktiva jobb." />

      <div className="flex items-center justify-between mt-8 mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Klart / misslyckat</h2>
        {finished.length > 0 && (
          <button
            type="button"
            onClick={() => jobQueue.clearFinished()}
            className="text-xs text-gray-500 hover:underline inline-flex items-center gap-1"
          >
            <Trash2 size={12} /> Rensa historik
          </button>
        )}
      </div>
      <Section title="" jobs={finished} emptyText="Ingen historik ännu." />
    </div>
  );
}

function Section({ title, jobs, emptyText }: { title: string; jobs: Job[]; emptyText: string }) {
  if (jobs.length === 0) {
    return (
      <div>
        {title && <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>}
        <p className="text-sm text-gray-400 italic">{emptyText}</p>
      </div>
    );
  }
  return (
    <div>
      {title && <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Status</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Jobb</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Typ</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Tid</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => <JobRow key={j.id} job={j} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  // För körande jobb visar vi inget exakt millisek-värde (annars triggar
  // varje setInterval en re-render). Bara start-tid och status räcker.
  const elapsed = job.finishedAt !== undefined
    ? job.finishedAt - (job.startedAt ?? job.enqueuedAt)
    : null;
  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2"><StatusBadge status={job.status} progress={job.progress} /></td>
      <td className="px-3 py-2">
        <div className="text-gray-900">{job.label}</div>
        {job.error && (
          <div className="text-xs text-red-600 font-mono mt-1 max-w-md truncate" title={job.error}>
            {job.error}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 font-mono">{job.kind}</td>
      <td className="px-3 py-2 text-xs text-gray-500">{elapsed !== null ? formatMs(elapsed) : "—"}</td>
      <td className="px-3 py-2 text-right"><JobActions job={job} /></td>
    </tr>
  );
}

/** Rad-actions: Avbryt (köad/körande) eller Försök igen (misslyckad/avbruten). */
function JobActions({ job }: { job: Job }) {
  if (job.status === "queued" || job.status === "running") {
    return (
      <button
        type="button"
        onClick={() => jobQueue.cancel(job.id)}
        className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"
        title="Avbryt"
      >
        <X size={12} /> Avbryt
      </button>
    );
  }
  if (job.status === "failed" || job.status === "canceled") {
    return (
      <button
        type="button"
        onClick={() => jobQueue.retry(job.id)}
        className="text-xs text-gray-500 hover:text-blue-600 inline-flex items-center gap-1"
        title="Försök igen"
      >
        <RotateCcw size={12} /> Försök igen
      </button>
    );
  }
  return null;
}

function StatusBadge({ status, progress }: { status: Job["status"]; progress?: number | undefined }) {
  const styles: Record<Job["status"], string> = {
    queued: "bg-gray-100 text-gray-700",
    running: "bg-blue-50 text-blue-800",
    done: "bg-green-50 text-green-800",
    failed: "bg-red-50 text-red-800",
    canceled: "bg-gray-50 text-gray-500",
  };
  const labels: Record<Job["status"], string> = {
    queued: "⏳ Köad",
    running: progress !== undefined ? `↻ ${Math.round(progress * 100)}%` : "↻ Körs",
    done: "✓ Klart",
    failed: "✗ Fel",
    canceled: "⊘ Avbruten",
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}
