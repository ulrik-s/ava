/**
 * `DayStepper` (#2095) — pilarna som stegar den valda dagen en dag i taget.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { DayStepper } from "@/components/ui/day-stepper";

function renderStepper(ymd: string, onChange = vi.fn()) {
  render(
    <DayStepper ymd={ymd} onChange={onChange}>
      <span>Dagsvalet</span>
    </DayStepper>,
  );
  return onChange;
}

const prev = (): HTMLElement => screen.getByRole("button", { name: "Föregående dag" });
const next = (): HTMLElement => screen.getByRole("button", { name: "Nästa dag" });

describe("DayStepper", () => {
  it("pilarna heter Föregående dag och Nästa dag, är vanliga knappar och har en dold ikon", () => {
    renderStepper("2026-11-24");
    for (const [button, label] of [[prev(), "Föregående dag"], [next(), "Nästa dag"]] as const) {
      expect(button).toHaveAttribute("title", label);
      expect(button).toHaveAttribute("type", "button");
      expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("dagsvalet står mellan pilarna, och raden bryts på en smal skärm", () => {
    renderStepper("2026-11-24");
    const middle = screen.getByText("Dagsvalet");
    expect(prev().compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(middle.compareDocumentPosition(next()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(middle.parentElement).toHaveClass("flex", "flex-wrap", "items-center", "gap-2");
  });

  it("‹ stegar en dag bakåt, över månadsskiftet", () => {
    const onChange = renderStepper("2026-03-01");
    fireEvent.click(prev());
    expect(onChange).toHaveBeenCalledWith("2026-02-28");
  });

  it("› stegar en dag framåt, över årsskiftet", () => {
    const onChange = renderStepper("2026-12-31");
    fireEvent.click(next());
    expect(onChange).toHaveBeenCalledWith("2027-01-01");
  });

  it("utan dag är båda pilarna avstängda och ett klick gör inget", () => {
    const onChange = renderStepper("");
    expect(prev()).toBeDisabled();
    expect(next()).toBeDisabled();
    fireEvent.click(prev());
    fireEvent.click(next());
    expect(onChange).not.toHaveBeenCalled();
  });
});
