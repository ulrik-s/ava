/**
 * #1162: DeadlineBadge + startsidans röda ruta (DeadlinesAlert).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { DeadlineBadge } from "@/components/tasks/deadline-badge";
import { DeadlinesAlert } from "@/components/tasks/deadlines-alert";

const day = (offset: number): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

let items: unknown[] = [];
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    user: { current: { useQuery: () => ({ data: { id: "u1" } }) } },
    task: { list: { useQuery: () => ({ data: { items, total: items.length } }) } },
  },
}));
vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

beforeEach(() => { items = []; });

describe("DeadlineBadge", () => {
  it("frist i dag → stor röd 'FRIST IDAG' (role=alert)", () => {
    render(<DeadlineBadge dueAt={day(0)} />);
    const badge = screen.getByRole("alert");
    expect(badge).toHaveTextContent("FRIST IDAG");
    expect(badge.className).toContain("bg-red-600");
    expect(badge.className).toContain("font-extrabold");
  });

  it("passerad → 'FÖRSENAD N DAGAR' / '1 DAG'", () => {
    const { rerender } = render(<DeadlineBadge dueAt={day(-3)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("FÖRSENAD 3 DAGAR");
    rerender(<DeadlineBadge dueAt={day(-1)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("FÖRSENAD 1 DAG");
  });

  it("kommande eller klar → diskret datum, inget larm; ingen frist → inget", () => {
    const { rerender, container } = render(<DeadlineBadge dueAt={day(5)} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/^Frist /)).toBeInTheDocument();
    rerender(<DeadlineBadge dueAt={day(-2)} done />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<DeadlineBadge dueAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DeadlinesAlert (startsidan)", () => {
  it("visar frister som är inne eller passerade — inte kommande eller klara", () => {
    items = [
      { id: "t1", title: "Inkomma med yttrande", dueAt: day(0), status: "TODO", matter: { id: "m1", matterNumber: "AA2026-0001", title: "Tvist" } },
      { id: "t2", title: "Svaromål", dueAt: day(-2), status: "IN_PROGRESS", matter: null },
      { id: "t3", title: "Kommande", dueAt: day(3), status: "TODO", matter: null },
      { id: "t4", title: "Klar", dueAt: day(-1), status: "DONE", matter: null },
    ];
    render(<DeadlinesAlert />);
    expect(screen.getByRole("region", { name: "Frister som är inne" })).toHaveTextContent("Frister som är inne (2)");
    expect(screen.getByText("Inkomma med yttrande")).toBeInTheDocument();
    expect(screen.getByText("Svaromål")).toBeInTheDocument();
    expect(screen.getByText(/AA2026-0001/)).toBeInTheDocument();
    expect(screen.queryByText("Kommande")).not.toBeInTheDocument();
    expect(screen.queryByText("Klar")).not.toBeInTheDocument();
  });

  it("inga frister inne → renderar inget", () => {
    items = [{ id: "t3", title: "Kommande", dueAt: day(3), status: "TODO", matter: null }];
    const { container } = render(<DeadlinesAlert />);
    expect(container).toBeEmptyDOMElement();
  });
});
