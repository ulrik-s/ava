/**
 * `HoursInput` (#1545) — tid i timmar med decimal, lagrad som minuter.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest-compat";
import { HoursInput, hasInvalidHours } from "@/components/ui/hours-input";

function field(): HTMLInputElement {
  return screen.getByRole("textbox");
}

describe("HoursInput", () => {
  it("visar minuterna i timmar med decimalkomma", () => {
    render(<HoursInput id="h" minutes={90} onChange={vi.fn()} />);
    expect(field()).toHaveValue("1,5");
    expect(field()).toHaveAttribute("inputmode", "decimal");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([["1,5", 90], ["1.5", 90], ["0,25", 15], ["2", 120]])("%s → %i minuter", (value, minutes) => {
    const onChange = vi.fn();
    const onValidChange = vi.fn();
    render(<HoursInput id="h" minutes={30} onChange={onChange} onValidChange={onValidChange} />);
    fireEvent.change(field(), { target: { value } });
    expect(onChange).toHaveBeenCalledWith(minutes);
    expect(onValidChange).toHaveBeenCalledWith(true);
  });

  it("ett otillåtet värde visar felet, markerar fältet och når inte föräldern", () => {
    const onChange = vi.fn();
    const onValidChange = vi.fn();
    render(<form data-testid="f"><HoursInput id="h" minutes={30} onChange={onChange} onValidChange={onValidChange} /></form>);
    fireEvent.change(field(), { target: { value: "1,33" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidChange).toHaveBeenCalledWith(false);
    expect(field()).toHaveValue("1,33");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAttribute("aria-describedby", "h-error");
    expect(field().validity.valid).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Ändra värdet");
    expect(hasInvalidHours(screen.getByTestId<HTMLFormElement>("f"))).toBe(true);
  });

  it("text som inte är ett tal ger ett fel", () => {
    render(<HoursInput id="h" minutes={30} onChange={vi.fn()} />);
    fireEvent.change(field(), { target: { value: "en timme" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ange tiden i timmar");
  });

  it("ett giltigt formulär har inget ogiltigt timfält", () => {
    render(<form data-testid="f"><HoursInput id="h" minutes={30} onChange={vi.fn()} /></form>);
    expect(hasInvalidHours(screen.getByTestId<HTMLFormElement>("f"))).toBe(false);
    expect(field().validity.valid).toBe(true);
  });

  it("adopterar ett värde som föräldern sätter utifrån", () => {
    function Harness() {
      const [minutes, setMinutes] = useState(30);
      return (
        <>
          <HoursInput id="h" minutes={minutes} onChange={setMinutes} />
          <button type="button" onClick={() => setMinutes(45)}>Sätt</button>
        </>
      );
    }
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "1,33" } });
    fireEvent.click(screen.getByText("Sätt"));
    expect(field()).toHaveValue("0,75");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
