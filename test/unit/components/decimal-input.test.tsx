/**
 * Tester för DecimalInput (#778) — numeriskt fält utan spinner-pilar:
 * tomt = null, komma-decimal tillåts, råtext-buffert hoppar inte till 0,
 * och fältet adopterar nytt value när föräldern ändrar det utifrån.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect } from "vitest-compat";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";

describe("parseDecimal", () => {
  it("tomt → null", () => expect(parseDecimal("")).toBeNull());
  it("komma-decimal → tal", () => expect(parseDecimal("12,5")).toBe(12.5));
  it("punkt-decimal → tal", () => expect(parseDecimal("12.5")).toBe(12.5));
  it("under min → null", () => expect(parseDecimal("-3", 0)).toBeNull());
  it("skräp → null", () => expect(parseDecimal("abc")).toBeNull());
});

describe("DecimalInput", () => {
  it("renderar inget spinbutton (inga upp/ner-pilar)", () => {
    render(<DecimalInput value={null} onChange={() => {}} />);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox").getAttribute("inputmode")).toBe("decimal");
  });

  it("null → tom ruta från början", () => {
    render(<DecimalInput value={null} onChange={() => {}} placeholder="Skriv in belopp" />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("rapporterar parsat tal och null vid tomt", () => {
    const seen: Array<number | null> = [];
    function Harness() {
      const [v, setV] = useState<number | null>(null);
      return <DecimalInput value={v} onChange={(n) => { seen.push(n); setV(n); }} />;
    }
    render(<Harness />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "750" } });
    expect(seen.at(-1)).toBe(750);
    fireEvent.change(box, { target: { value: "" } });
    expect(seen.at(-1)).toBeNull();
  });

  it("behåller råtext (t.ex. '12,') utan att hoppa till 0", () => {
    function Harness() {
      const [v, setV] = useState<number | null>(null);
      return <DecimalInput value={v} onChange={setV} />;
    }
    render(<Harness />);
    const box = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "12," } });
    expect(box.value).toBe("12,"); // inte "12" eller "0"
  });

  it("adopterar nytt value när föräldern ändrar det utifrån (förifyllning)", () => {
    const { rerender } = render(<DecimalInput value={null} onChange={() => {}} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    rerender(<DecimalInput value={1000} onChange={() => {}} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("1000");
  });
});
