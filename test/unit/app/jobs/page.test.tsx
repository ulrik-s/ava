/**
 * Test för `/jobs`-sidan — rad-rendering, status-badge, tidsformat och
 * rad-actions (Avbryt / Försök igen). Täcker den utbrutna `JobActions`
 * (#6-ratchet: JobRow låg på complexity 9) i alla tre grenar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Job } from "@/lib/client/jobs/job-queue";

let JOBS: Job[] = [];
const cancel = vi.fn();
const retry = vi.fn();
const clearFinished = vi.fn();

vi.mock("@/lib/client/jobs/use-jobs", () => ({ useJobs: () => JOBS }));
vi.mock("@/lib/client/jobs/job-queue", () => ({
  jobQueue: { cancel, retry, clearFinished },
}));

// Importeras efter mockarna (bun/vitest hoistar vi.mock).
import JobsPage from "@/app/jobs/page";

function job(over: Partial<Job> & Pick<Job, "id" | "status">): Job {
  return { kind: "classify-document", label: `Jobb ${over.id}`, enqueuedAt: 1000, ...over } as Job;
}

beforeEach(() => {
  vi.clearAllMocks();
  JOBS = [];
});

describe("JobsPage / JobActions", () => {
  it("körande jobb → Avbryt-knapp som anropar jobQueue.cancel", () => {
    JOBS = [job({ id: "r1", status: "running", progress: 0.5 })];
    render(<JobsPage />);
    const row = screen.getByRole("row", { name: /Jobb r1/ });
    fireEvent.click(within(row).getByRole("button", { name: /Avbryt/ }));
    expect(cancel).toHaveBeenCalledWith("r1");
    expect(screen.getByText("↻ 50%")).toBeInTheDocument();
  });

  it("köat jobb utan progress → '↻ Körs'/'⏳ Köad' + Avbryt", () => {
    JOBS = [job({ id: "q1", status: "queued" }), job({ id: "r2", status: "running" })];
    render(<JobsPage />);
    expect(screen.getByText("⏳ Köad")).toBeInTheDocument();
    expect(screen.getByText("↻ Körs")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Avbryt/ })).toHaveLength(2);
  });

  it("misslyckat jobb → Försök igen (anropar retry) + felmeddelande", () => {
    JOBS = [job({ id: "f1", status: "failed", error: "boom", startedAt: 1000, finishedAt: 1500 })];
    render(<JobsPage />);
    const row = screen.getByRole("row", { name: /Jobb f1/ });
    expect(within(row).getByTitle("boom")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /Försök igen/ }));
    expect(retry).toHaveBeenCalledWith("f1");
  });

  it("avbrutet jobb → Försök igen", () => {
    JOBS = [job({ id: "c1", status: "canceled", startedAt: 1000, finishedAt: 1500 })];
    render(<JobsPage />);
    expect(screen.getByRole("button", { name: /Försök igen/ })).toBeInTheDocument();
  });

  it("klart jobb → varken Avbryt eller Försök igen", () => {
    JOBS = [job({ id: "d1", status: "done", startedAt: 1000, finishedAt: 1500 })];
    render(<JobsPage />);
    expect(screen.getByText("✓ Klart")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Avbryt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Försök igen/ })).not.toBeInTheDocument();
  });

  it("formatMs: ms / s / min beroende på förfluten tid", () => {
    JOBS = [
      job({ id: "ms", status: "done", startedAt: 0, finishedAt: 500 }),
      job({ id: "s", status: "done", startedAt: 0, finishedAt: 5_000 }),
      job({ id: "min", status: "done", startedAt: 0, finishedAt: 120_000 }),
    ];
    render(<JobsPage />);
    expect(screen.getByText("500 ms")).toBeInTheDocument();
    expect(screen.getByText("5.0 s")).toBeInTheDocument();
    expect(screen.getByText("2.0 min")).toBeInTheDocument();
  });

  it("'Rensa historik' syns när historik finns och anropar clearFinished", () => {
    JOBS = [job({ id: "d1", status: "done", startedAt: 0, finishedAt: 10 })];
    render(<JobsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Rensa historik/ }));
    expect(clearFinished).toHaveBeenCalled();
  });

  it("tomt läge → tom-texter, ingen Rensa-knapp", () => {
    JOBS = [];
    render(<JobsPage />);
    expect(screen.getByText("Inga aktiva jobb.")).toBeInTheDocument();
    expect(screen.getByText("Ingen historik ännu.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rensa historik/ })).not.toBeInTheDocument();
  });
});
