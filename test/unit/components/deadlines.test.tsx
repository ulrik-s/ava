/**
 * #1162: DeadlineBadge — frist idag / försenad i stor fet röd text.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import { DeadlineBadge } from "@/components/tasks/deadline-badge";

const day = (offset: number): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

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
