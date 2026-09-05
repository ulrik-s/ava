import { describe, it, expect } from "vitest-compat";
import { assertVoucherDelta, voucherKey } from "../../../tooling/scripts/fortnox-harness";

/**
 * Delta-kollen (#1050) är den enda kontrollen som kan se att det landade
 * något MER i Fortnox än vad testet skickade. Per-verifikat-läsningen frågar
 * efter verifikat vi själva känner till och kan därför aldrig upptäcka en
 * dubblett — och en dubbelbokförd faktura går inte att ta tillbaka via API:t.
 *
 * Därför testas logiken här, mot mängder, utan nät: det är billigt och det
 * fäller på exakt de fall som gör ont skarpt.
 */
describe("assertVoucherDelta (#1050)", () => {
  const before = new Set(["A/1", "A/2"]);

  it("släpper igenom när exakt de förväntade verifikaten tillkommit", () => {
    const after = new Set([...before, "A/3", "A/4"]);
    expect(() => assertVoucherDelta(before, after, ["A/3", "A/4"])).not.toThrow();
  });

  it("bryr sig inte om ordningen — Fortnox listar inte i skapandeordning", () => {
    const after = new Set([...before, "A/4", "A/3"]);
    expect(() => assertVoucherDelta(before, after, ["A/3", "A/4"])).not.toThrow();
  });

  // Det här är hela poängen: ett verifikat vi inte bad om.
  it("fäller på ett OVÄNTAT verifikat och namnger det", () => {
    const after = new Set([...before, "A/3", "A/4"]);
    expect(() => assertVoucherDelta(before, after, ["A/3"]))
      .toThrow(/A\/4/);
  });

  it("kallar det oväntade för dubblett/strökontering, inte bara \"fel\"", () => {
    const after = new Set([...before, "A/3", "A/4"]);
    expect(() => assertVoucherDelta(before, after, ["A/3"]))
      .toThrow(/Dubblett eller strökontering/);
  });

  // Motsatta felet: pushen sa 200 men verifikatet finns inte.
  it("fäller när ett förväntat verifikat SAKNAS trots lyckad push", () => {
    const after = new Set([...before, "A/3"]);
    expect(() => assertVoucherDelta(before, after, ["A/3", "A/4"]))
      .toThrow(/saknas i Fortnox.*A\/4/s);
  });

  it("ignorerar verifikat som fanns redan före körningen", () => {
    const fat = new Set(["A/1", "A/2", "A/3", "A/4", "A/5"]);
    expect(() => assertVoucherDelta(fat, new Set([...fat, "A/6"]), ["A/6"])).not.toThrow();
  });

  // Ett tomt delta är giltigt (dry-run), men bara om inget förväntades.
  it("accepterar tomt delta när inget förväntades", () => {
    expect(() => assertVoucherDelta(before, new Set(before), [])).not.toThrow();
  });

  it("fäller på tomt delta när något förväntades", () => {
    expect(() => assertVoucherDelta(before, new Set(before), ["A/3"])).toThrow(/saknas/);
  });
});

describe("voucherKey", () => {
  it("formar nyckeln som Fortnox externa id: serie/nummer", () => {
    expect(voucherKey({ VoucherSeries: "A", VoucherNumber: 7 })).toBe("A/7");
  });
});
