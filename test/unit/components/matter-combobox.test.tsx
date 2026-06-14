/**
 * Tester för MatterCombobox — sökbar val-input för ärenden.
 *
 * Bevisar:
 *   1. När user skriver så syns texten i input.
 *   2. När user typar en exakt matchning av "<nr> — <titel>", anropas
 *      onChange med det matter-id:t.
 *   3. När input töms, anropas onChange med "".
 *   4. När value-prop bytts utifrån, reflekteras matchande display i input.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { MatterCombobox, type MatterOption } from "@/components/matter/matter-combobox";

const MATTERS: MatterOption[] = [
  { id: "m-001", matterNumber: "2026-0001", title: "Vårdnadstvist Andersson" },
  { id: "m-002", matterNumber: "2026-0002", title: "Bostadsrätt Bergman" },
  { id: "m-016", matterNumber: "2026-0016", title: "Brottmål RH" },
];

describe("MatterCombobox", () => {
  it("input visar texten användaren skriver", () => {
    const onChange = vi.fn();
    render(<MatterCombobox matters={MATTERS} value="" onChange={onChange} label="Ärende" />);
    const input = screen.getByLabelText("Ärende") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026" } });
    expect(input.value).toBe("2026");
  });

  it("ropar onChange med matching id när exakt vald sträng skrivs", () => {
    const onChange = vi.fn();
    render(<MatterCombobox matters={MATTERS} value="" onChange={onChange} label="Ärende" />);
    const input = screen.getByLabelText("Ärende") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-0001 — Vårdnadstvist Andersson" } });
    expect(onChange).toHaveBeenCalledWith("m-001");
  });

  it("ropar onChange('') när input töms", () => {
    const onChange = vi.fn();
    render(<MatterCombobox matters={MATTERS} value="m-001" onChange={onChange} label="Ärende" />);
    const input = screen.getByLabelText("Ärende") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("ropar INTE onChange medan användaren bara skriver fritt (delvis match)", () => {
    const onChange = vi.fn();
    render(<MatterCombobox matters={MATTERS} value="" onChange={onChange} label="Ärende" />);
    const input = screen.getByLabelText("Ärende") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "vårdn" } });
    // Ingen full match → onChange ska inte hetta något matter-id
    expect(onChange).not.toHaveBeenCalledWith("m-001");
  });

  it("visar valt matter-namn i input när value-prop sätts utifrån", () => {
    const { rerender } = render(<MatterCombobox matters={MATTERS} value="" onChange={vi.fn()} label="Ärende" />);
    rerender(<MatterCombobox matters={MATTERS} value="m-016" onChange={vi.fn()} label="Ärende" />);
    const input = screen.getByLabelText("Ärende") as HTMLInputElement;
    expect(input.value).toBe("2026-0016 — Brottmål RH");
  });

  it("renderar alla matter-options i datalist", () => {
    const { container } = render(<MatterCombobox matters={MATTERS} value="" onChange={vi.fn()} label="Ärende" />);
    const options = container.querySelectorAll("datalist option");
    expect(options.length).toBe(3);
    expect(options[0]!.getAttribute("value")).toBe("2026-0001 — Vårdnadstvist Andersson");
  });
});
