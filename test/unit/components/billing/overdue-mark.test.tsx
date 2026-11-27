/** `OverdueMark` (#2136): "Förfallen 1 dag" och "Förfallen N dagar", röd markering. */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { MARK_CLASS, OverdueMark } from "@/components/billing/overdue-mark";

describe("OverdueMark", () => {
  it("1 dag i singular och N dagar i plural, med den röda klassen", () => {
    const { rerender } = render(<OverdueMark days={1} />);
    expect(screen.getByText("Förfallen 1 dag")).toHaveClass("bg-red-100");
    rerender(<OverdueMark days={12} />);
    expect(screen.getByText("Förfallen 12 dagar").className).toContain(MARK_CLASS);
  });
});
