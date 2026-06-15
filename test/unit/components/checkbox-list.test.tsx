/**
 * Test för CheckboxList — kompakt filtrerbar multi-select (kollegor/kontakter
 * till kalender-event). Ren, kontrollerad komponent: vi verifierar rendering,
 * filtrering (label + sublabel), tomtillstånd, toggla på/av och markerat-räknare.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { CheckboxList, type CheckboxOption } from "@/components/ui/checkbox-list";

const OPTIONS: CheckboxOption[] = [
  { id: "u1", label: "Anna Advokat", sublabel: "Partner" },
  { id: "u2", label: "Björn Bauer", sublabel: "Biträdande" },
  { id: "u3", label: "Cecilia Carlsson" },
];

describe("CheckboxList", () => {
  it("renderar label och alla alternativ", () => {
    render(<CheckboxList options={OPTIONS} selectedIds={[]} onChange={vi.fn()} label="Bjud in" />);
    expect(screen.getByText("Bjud in")).toBeInTheDocument();
    expect(screen.getByText("Anna Advokat")).toBeInTheDocument();
    expect(screen.getByText("Cecilia Carlsson")).toBeInTheDocument();
  });

  it("default-placeholder 'Sök…' när ingen anges", () => {
    render(<CheckboxList options={OPTIONS} selectedIds={[]} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText("Sök…")).toBeInTheDocument();
  });

  it("filtrerar på label (case-insensitive)", () => {
    render(<CheckboxList options={OPTIONS} selectedIds={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "björn" } });
    expect(screen.getByText("Björn Bauer")).toBeInTheDocument();
    expect(screen.queryByText("Anna Advokat")).not.toBeInTheDocument();
  });

  it("filtrerar även på sublabel", () => {
    render(<CheckboxList options={OPTIONS} selectedIds={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "partner" } });
    expect(screen.getByText("Anna Advokat")).toBeInTheDocument();
    expect(screen.queryByText("Björn Bauer")).not.toBeInTheDocument();
  });

  it("visar tommeddelande (default + custom) när inget matchar", () => {
    const { rerender } = render(<CheckboxList options={OPTIONS} selectedIds={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    expect(screen.getByText("Inga matchningar.")).toBeInTheDocument();
    rerender(<CheckboxList options={[]} selectedIds={[]} onChange={vi.fn()} emptyMessage="Inga kollegor" />);
    expect(screen.getByText("Inga kollegor")).toBeInTheDocument();
  });

  it("toggla ett omarkerat alternativ → onChange med id tillagt", () => {
    const onChange = vi.fn();
    render(<CheckboxList options={OPTIONS} selectedIds={["u1"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Björn Bauer"));
    expect(onChange).toHaveBeenCalledWith(["u1", "u2"]);
  });

  it("toggla ett markerat alternativ → onChange med id borttaget", () => {
    const onChange = vi.fn();
    render(<CheckboxList options={OPTIONS} selectedIds={["u1", "u2"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Anna Advokat"));
    expect(onChange).toHaveBeenCalledWith(["u2"]);
  });

  it("checkboxar reflekterar selectedIds", () => {
    render(<CheckboxList options={OPTIONS} selectedIds={["u2"]} onChange={vi.fn()} />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0]!.checked).toBe(false); // u1
    expect(boxes[1]!.checked).toBe(true); // u2
  });

  it("visar markerat-räknare när något är valt", () => {
    render(<CheckboxList options={OPTIONS} selectedIds={["u1", "u3"]} onChange={vi.fn()} />);
    expect(screen.getByText("2 markerade")).toBeInTheDocument();
  });

  it("ingen räknare när inget är valt", () => {
    render(<CheckboxList options={OPTIONS} selectedIds={[]} onChange={vi.fn()} />);
    expect(screen.queryByText(/markerade/)).not.toBeInTheDocument();
  });
});
