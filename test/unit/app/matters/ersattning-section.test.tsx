/**
 * Ersättningstypen i kostnadsräkningsdialogen (#1858): valen, det valda,
 * förhören ur ofrusna poster, domänens förordnande-indata och anropets yrkande
 * (en diskriminerad union), plus avslutets och förhörens avsnitt.
 */

import { fireEvent, render, renderHook, act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import {
  AvslutChoice, ersattningOf, ersattningOptions, ForhorSection, forhorOf, forordnandeInputOf, krRunClaimOf, useErsattning,
} from "@/app/matters/[id]/_ersattning-section";
import { asId } from "@/lib/shared/schemas/ids";

/** Ett förhör en vardag kl. 10.00 (UTC 09.00 i mars), 45 minuter. */
const FORHOR = { kind: "FORHOR" as const, date: "2026-03-04T09:00:00.000Z", minutes: 45 };
const ARBETE = { kind: "ARBETE" as const, date: "2026-03-03", minutes: 60 };

describe("ersattningOptions", () => {
  it("offentligt uppdrag med förhandling: taxa, förordnandetaxa och icke-taxa", () => {
    expect(ersattningOptions(true, true)).toEqual(["taxa", "forordnande", "lopande"]);
  });
  it("offentligt uppdrag utan förhandling: förordnandetaxa och icke-taxa", () => {
    expect(ersattningOptions(false, true)).toEqual(["forordnande", "lopande"]);
  });
  it("inte offentligt uppdrag: som i dag", () => {
    expect(ersattningOptions(true, false)).toEqual(["taxa", "lopande"]);
    expect(ersattningOptions(false, false)).toEqual(["lopande"]);
  });
});

describe("ersattningOf", () => {
  it("förordnandetaxan bara i ett offentligt uppdrag", () => {
    expect(ersattningOf({ forordnande: true, isOffentligtUppdrag: true, hearing: true, isTaxe: true })).toBe("forordnande");
    expect(ersattningOf({ forordnande: true, isOffentligtUppdrag: false, hearing: true, isTaxe: true })).toBe("taxa");
  });
  it("brottmålstaxan kräver förhandling och taxeval, annars löpande", () => {
    expect(ersattningOf({ forordnande: false, isOffentligtUppdrag: true, hearing: true, isTaxe: false })).toBe("lopande");
    expect(ersattningOf({ forordnande: false, isOffentligtUppdrag: true, hearing: false, isTaxe: true })).toBe("lopande");
  });
});

describe("forhorOf", () => {
  it("bara FORHOR-poster som inte är låsta", () => {
    const frozen = { ...FORHOR, date: "2026-03-05T09:00:00.000Z", frozenAt: "2026-03-06" };
    const forhor = forhorOf([ARBETE, FORHOR, frozen]);
    expect(forhor).toHaveLength(1);
    expect(new Date(forhor[0]?.start ?? 0).toISOString()).toBe(FORHOR.date);
  });
});

describe("forordnandeInputOf", () => {
  it("inget utanför förordnandeläget", () => {
    expect(forordnandeInputOf("taxa", [FORHOR], "NEDLAGD")).toEqual({});
  });
  it("förhören och avslutet i förordnandeläget", () => {
    const input = forordnandeInputOf("forordnande", [FORHOR], "NEDLAGD");
    expect(input.forordnande?.forhor).toHaveLength(1);
    expect(input.forordnande?.avslut).toBe("NEDLAGD");
  });
  it("utan valt avslut: förhören utan avslut", () => {
    expect(forordnandeInputOf("forordnande", [], null)).toEqual({ forordnande: { forhor: [] } });
  });
});

describe("krRunClaimOf", () => {
  const base = { hufStart: "2026-03-01T09:00", hufEnd: "2026-03-01T10:00", taxaLevel: 2 as const, hasFTax: true };
  it("förordnandetaxan: avslutet och F-skatt", () => {
    expect(krRunClaimOf({ ...base, ersattning: "forordnande", avslut: "STRAFFORELAGGANDE" }))
      .toEqual({ forordnande: { avslut: "STRAFFORELAGGANDE" }, hasFTax: true });
  });
  it("förordnandetaxan utan avslut: inget yrkande", () => {
    expect(krRunClaimOf({ ...base, ersattning: "forordnande", avslut: null })).toBeNull();
  });
  it("brottmålstaxan och löpande: förhandlingsfälten som förut", () => {
    expect(krRunClaimOf({ ...base, ersattning: "taxa", avslut: null })).toEqual({
      hufStart: new Date(base.hufStart).toISOString(), hufEnd: new Date(base.hufEnd).toISOString(),
      taxaLevel: 2, isTaxeArende: true, hasFTax: true,
    });
    expect(krRunClaimOf({ ...base, ersattning: "lopande", avslut: null })).toMatchObject({ isTaxeArende: false });
  });
});

describe("useErsattning", () => {
  it("med förhandling: ärendets taxeval är förvalt, och valen byter grund", () => {
    const { result } = renderHook(() => useErsattning({ initialIsTaxe: undefined, isOffentligtUppdrag: true, hearing: true }));
    expect(result.current.ersattning).toBe("taxa");
    act(() => result.current.onErsattning("forordnande"));
    expect(result.current.ersattning).toBe("forordnande");
    act(() => result.current.onErsattning("lopande"));
    expect(result.current.ersattning).toBe("lopande");
    act(() => result.current.onErsattning("taxa"));
    expect(result.current.ersattning).toBe("taxa");
  });
  it("utan förhandling är icke-taxa förvald", () => {
    const { result } = renderHook(() => useErsattning({ initialIsTaxe: true, isOffentligtUppdrag: true, hearing: false }));
    expect(result.current.ersattning).toBe("lopande");
    expect(result.current.options).toEqual(["forordnande", "lopande"]);
  });
  it("avslutet sparas", () => {
    const { result } = renderHook(() => useErsattning({ initialIsTaxe: false, isOffentligtUppdrag: true, hearing: false }));
    expect(result.current.avslut).toBeNull();
    act(() => result.current.setAvslut("INGET_ATAL"));
    expect(result.current.avslut).toBe("INGET_ATAL");
  });
});

describe("AvslutChoice", () => {
  it("tre val med de delade nycklarna, och en uppmaning tills ett är valt", () => {
    const onChange = vi.fn();
    render(<AvslutChoice avslut={null} onChange={onChange} />);
    expect(screen.getByText("Välj hur förundersökningen avslutades.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Strafföreläggande godkändes"));
    expect(onChange).toHaveBeenCalledWith("STRAFFORELAGGANDE");
    expect(screen.getByLabelText("Lades ned")).toBeInTheDocument();
    expect(screen.getByLabelText("Avslutades utan åtal")).toBeInTheDocument();
  });
  it("med valt avslut: ingen uppmaning", () => {
    render(<AvslutChoice avslut="NEDLAGD" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Lades ned")).toBeChecked();
    expect(screen.queryByText("Välj hur förundersökningen avslutades.")).not.toBeInTheDocument();
  });
});

describe("ForhorSection", () => {
  it("antal och sammanlagd förhörstid, och dokumentets noter", () => {
    render(<ForhorSection forhor={forhorOf([FORHOR, { ...FORHOR, date: "2026-03-05T09:00:00.000Z" }])} notes={["Gränsvärdet överskrids."]} />);
    expect(screen.getByLabelText("Förhör")).toHaveTextContent("2 förhör, sammanlagt 1,5 h");
    expect(screen.getByText("Gränsvärdet överskrids.")).toBeInTheDocument();
  });
  it("utan förhör: taxans lägsta belopp", () => {
    render(<ForhorSection forhor={[]} notes={[]} />);
    expect(screen.getByLabelText("Förhör")).toHaveTextContent("Inga förhör registrerade");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});

// asId används för att typa låsfältet som en körning (frozenByBillingRunId).
describe("forhorOf med körningens lås", () => {
  it("en post som en körning frös räknas inte", () => {
    expect(forhorOf([{ ...FORHOR, frozenByBillingRunId: asId<"BillingRunId">("run-1") }])).toEqual([]);
  });
});
