/**
 * `DayStepper` (#2095) — pilarna som stegar den valda dagen en dag i taget,
 * eller en vecka eller månad med `unit` (#2111).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { DayStepper } from "@/components/ui/day-stepper";
import type { DayStepUnit } from "@/lib/shared/calendar-periods";

function renderStepper(ymd: string, onChange = vi.fn(), unit?: DayStepUnit) {
  render(
    <DayStepper ymd={ymd} onChange={onChange} {...(unit ? { unit } : {})}>
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

  it("unit=week: pilarna heter Föregående vecka och Nästa vecka och stegar sju dagar", () => {
    const onChange = renderStepper("2026-11-24", vi.fn(), "week");
    const back = screen.getByRole("button", { name: "Föregående vecka" });
    const forward = screen.getByRole("button", { name: "Nästa vecka" });
    expect(back).toHaveAttribute("title", "Föregående vecka");
    expect(forward).toHaveAttribute("title", "Nästa vecka");
    fireEvent.click(back);
    expect(onChange).toHaveBeenLastCalledWith("2026-11-17");
    fireEvent.click(forward);
    expect(onChange).toHaveBeenLastCalledWith("2026-12-01");
  });

  it("unit=month: Nästa månad från 31 januari ger 28 februari", () => {
    const onChange = renderStepper("2026-01-31", vi.fn(), "month");
    fireEvent.click(screen.getByRole("button", { name: "Nästa månad" }));
    expect(onChange).toHaveBeenCalledWith("2026-02-28");
    expect(screen.getByRole("button", { name: "Föregående månad" })).toHaveAttribute("title", "Föregående månad");
  });

  it("unit=month: Föregående månad från 31 mars ger 28 februari", () => {
    const onChange = renderStepper("2026-03-31", vi.fn(), "month");
    fireEvent.click(screen.getByRole("button", { name: "Föregående månad" }));
    expect(onChange).toHaveBeenCalledWith("2026-02-28");
  });
});
