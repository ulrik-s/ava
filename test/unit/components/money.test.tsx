/**
 * Tester för <Money> + VatDisplayProvider (#781): klickbart belopp som växlar
 * inkl/exkl moms globalt, korrekt split för net/gross-basis, och att alla
 * <Money> i trädet följer samma läge.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest-compat";
import { Money } from "@/components/ui/money";
import { VatDisplayProvider } from "@/lib/client/vat/vat-display-context";

beforeEach(() => {
  window.localStorage.clear();
});

function renderInProvider(ui: React.ReactNode) {
  return render(<VatDisplayProvider>{ui}</VatDisplayProvider>);
}

describe("Money", () => {
  it("net-basis: visar inkl. moms som standard, exkl. efter klick", () => {
    renderInProvider(<Money ore={100000} basis="net" />); // 1000 kr exkl
    const btn = screen.getByRole("button");
    expect(btn.textContent).toMatch(/1\s*250,00/); // inkl (25 %) — standardläge
    fireEvent.click(btn);
    expect(btn.textContent).toMatch(/1\s*000,00/); // exkl efter klick
  });

  it("gross-basis: 1250 kr inkl visar bruttot som standard, exkl efter klick", () => {
    renderInProvider(<Money ore={125000} basis="gross" />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toMatch(/1\s*250,00/); // inkl = lagrade bruttot (standard)
    fireEvent.click(btn);
    expect(btn.textContent).toMatch(/1\s*000,00/); // exkl härlett ur brutto
  });

  it("respekterar momssats (0 % → exkl = inkl)", () => {
    renderInProvider(<Money ore={50000} basis="net" vatRate={0} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toMatch(/500,00/);
    fireEvent.click(btn);
    expect(btn.textContent).toMatch(/500,00/); // momsfritt → oförändrat
  });

  it("alla belopp följer samma globala läge", () => {
    renderInProvider(
      <>
        <Money ore={100000} basis="net" />
        <Money ore={200000} basis="net" />
      </>,
    );
    const [a, b] = screen.getAllByRole("button");
    expect(a!.textContent).toMatch(/1\s*250,00/); // standard inkl
    fireEvent.click(a!); // växla via det ena → exkl
    expect(a!.textContent).toMatch(/1\s*000,00/);
    expect(b!.textContent).toMatch(/2\s*000,00/); // det andra växlade också till exkl
  });

  it("läget persisteras i localStorage", () => {
    renderInProvider(<Money ore={100000} basis="net" />);
    fireEvent.click(screen.getByRole("button")); // incl → excl
    expect(window.localStorage.getItem("ava.vatDisplayMode")).toBe("excl");
  });
});
