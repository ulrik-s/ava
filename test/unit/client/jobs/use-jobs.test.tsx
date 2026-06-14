/**
 * Tester för `useJobs` / `useJobsSummary` (#27 — otestad). Mockar jobQueue och
 * verifierar snapshot + summerings-logiken (counts + senaste fel).
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { Job } from "@/lib/client/jobs/job-queue";

import { useJobs, useJobsSummary } from "@/lib/client/jobs/use-jobs";

let jobsData: Job[] = [];
vi.mock("@/lib/client/jobs/job-queue", () => ({
  jobQueue: {
    list: () => jobsData,
    subscribe: (_fn: (j: Job[]) => void) => () => {},
  },
}));

function job(over: Partial<Job> & Pick<Job, "id" | "status">): Job {
  return { kind: "classify-document", label: `J ${over.id}`, enqueuedAt: 0, ...over } as Job;
}

function SummaryProbe() {
  return <div data-testid="s">{JSON.stringify(useJobsSummary())}</div>;
}
function ListProbe() {
  return <div data-testid="n">{useJobs().length}</div>;
}

beforeEach(() => { vi.clearAllMocks(); jobsData = []; });

describe("useJobs / useJobsSummary", () => {
  it("useJobs returnerar jobQueue.list()-snapshoten", () => {
    jobsData = [job({ id: "a", status: "queued" }), job({ id: "b", status: "running" })];
    render(<ListProbe />);
    expect(screen.getByTestId("n").textContent).toBe("2");
  });

  it("summerar queued/running/failed + senaste fel", () => {
    jobsData = [
      job({ id: "q", status: "queued" }),
      job({ id: "r", status: "running" }),
      job({ id: "f1", status: "failed", error: "först" }),
      job({ id: "f2", status: "failed", error: "sist" }),
      job({ id: "d", status: "done" }),
    ];
    render(<SummaryProbe />);
    const s = JSON.parse(screen.getByTestId("s").textContent ?? "{}");
    expect(s).toEqual({ total: 5, queued: 1, running: 1, failed: 2, lastError: "först" });
  });

  it("tom kö → nollor + lastError null", () => {
    jobsData = [];
    render(<SummaryProbe />);
    expect(JSON.parse(screen.getByTestId("s").textContent ?? "{}")).toEqual({
      total: 0, queued: 0, running: 0, failed: 0, lastError: null,
    });
  });
});
