/**
 * Test för den delade `Pager` (#6-ratchet, DRY). Täcker: dold vid ≤1 sida /
 * saknad data, sidräknare, "(N totalt)" bara med showTotal, och prev/next.
 */
import { describe, it, expect, vi } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pager } from "@/components/ui/pager";

describe("Pager", () => {
  it("renderar inget vid en sida eller saknad data", () => {
    const { container, rerender } = render(<Pager data={undefined} page={1} onPage={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Pager data={{ pages: 1, total: 5 }} page={1} onPage={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("visar sidräknare utan total som default", () => {
    render(<Pager data={{ pages: 3, total: 42 }} page={2} onPage={vi.fn()} />);
    expect(screen.getByText("Sida 2 av 3")).toBeInTheDocument();
    expect(screen.queryByText(/totalt/)).not.toBeInTheDocument();
  });

  it("visar '(N totalt)' när showTotal är satt", () => {
    render(<Pager data={{ pages: 3, total: 42 }} page={1} onPage={vi.fn()} showTotal />);
    expect(screen.getByText("Sida 1 av 3 (42 totalt)")).toBeInTheDocument();
  });

  it("Föregående/Nästa anropar onPage; kant-knappar disabled", () => {
    const onPage = vi.fn();
    const { rerender } = render(<Pager data={{ pages: 3 }} page={1} onPage={onPage} />);
    const prev = screen.getByRole("button", { name: /Föregående/ });
    const next = screen.getByRole("button", { name: /Nästa/ });
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(onPage).toHaveBeenCalledWith(2);

    rerender(<Pager data={{ pages: 3 }} page={3} onPage={onPage} />);
    expect(screen.getByRole("button", { name: /Nästa/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Föregående/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
