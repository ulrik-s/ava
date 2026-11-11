/**
 * Tester för <ShowHiddenToggle> + useHiddenRows (#1522): dolda rader från
 * början, knappen med antal, och att klick visar/döljer dem igen.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { ShowHiddenToggle, useHiddenRows } from "@/components/ui/show-hidden-toggle";

function List({ rows }: { rows: string[] }) {
  const { rows: shown, toggle } = useHiddenRows(rows, (r) => r.startsWith("x"));
  return (
    <>
      <ShowHiddenToggle {...toggle} />
      <ul>{shown.map((r) => <li key={r}>{r}</li>)}</ul>
    </>
  );
}

describe("ShowHiddenToggle", () => {
  it("renderar inget när inga rader är dolda", () => {
    const { container } = render(<ShowHiddenToggle hiddenCount={0} shown={false} onToggle={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("visar antalet dolda och anropar onToggle", () => {
    let clicks = 0;
    render(<ShowHiddenToggle hiddenCount={3} shown={false} onToggle={() => { clicks += 1; }} />);
    const button = screen.getByRole("button", { name: "Visa annullerade (3)" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(clicks).toBe(1);
  });

  it("heter Dölj annullerade när de dolda visas", () => {
    render(<ShowHiddenToggle hiddenCount={3} shown onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Dölj annullerade" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("useHiddenRows", () => {
  it("döljer raderna från början och visar dem i ursprunglig ordning efter klick", () => {
    render(<List rows={["a", "x1", "b", "x2"]} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (2)" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["a", "x1", "b", "x2"]);
    fireEvent.click(screen.getByRole("button", { name: "Dölj annullerade" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["a", "b"]);
  });

  it("visar ingen knapp när inget är dolt", () => {
    render(<List rows={["a", "b"]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
