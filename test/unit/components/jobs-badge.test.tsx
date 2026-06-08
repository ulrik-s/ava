/**
 * Tester för `JobsBadge` — top-bar-indikator för jobbkön.
 *
 */

import { describe, it, expect, vi } from "vitest-compat";
import { render, screen } from "@testing-library/react";
import { JobsBadge } from "@/components/shell/jobs-badge";

const summary = { total: 0, queued: 0, running: 0, failed: 0, lastError: null as string | null };
vi.mock("@/lib/client/jobs/use-jobs", () => ({
  useJobsSummary: () => summary,
}));

function setSummary(s: Partial<typeof summary>): void {
  summary.queued = s.queued ?? 0;
  summary.running = s.running ?? 0;
  summary.failed = s.failed ?? 0;
  summary.total = (s.queued ?? 0) + (s.running ?? 0) + (s.failed ?? 0);
}

describe("JobsBadge", () => {
  it("renderar inget när kön är tom", () => {
    setSummary({});
    const { container } = render(<JobsBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("running > 0: 'N jobb körs'", () => {
    setSummary({ running: 2 });
    render(<JobsBadge />);
    expect(screen.getByText(/2 jobb körs/)).toBeInTheDocument();
  });

  it("bara queued (inget running): 'N jobb väntar'", () => {
    setSummary({ queued: 3 });
    render(<JobsBadge />);
    expect(screen.getByText(/3 jobb väntar/)).toBeInTheDocument();
  });

  it("bara failed: singular ('misslyckat')", () => {
    setSummary({ failed: 1 });
    render(<JobsBadge />);
    expect(screen.getByText(/1 misslyckat/)).toBeInTheDocument();
  });

  it("bara failed: plural ('misslyckata')", () => {
    setSummary({ failed: 3 });
    render(<JobsBadge />);
    expect(screen.getByText(/3 misslyckata/)).toBeInTheDocument();
  });

  it("running + failed: prioriterar running-state (visas som 'körs')", () => {
    setSummary({ running: 1, failed: 2 });
    render(<JobsBadge />);
    expect(screen.getByText(/1 jobb körs/)).toBeInTheDocument();
  });

  it("klick leder till /jobs", () => {
    setSummary({ running: 1 });
    render(<JobsBadge />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/jobs");
  });
});
