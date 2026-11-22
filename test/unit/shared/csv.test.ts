/**
 * CSV för svenskt Excel (#1792): BOM, `;`, CRLF, citering, formelskydd och
 * talhjälparna för kronor och timmar.
 */

import { describe, expect, it } from "vitest-compat";
import { csvHoursFromMinutes, csvKrFromOre, num, text, toCsv } from "@/lib/shared/csv";

const BOM = "﻿";
/** Ett fält, utan BOM och radslut. */
const field = (value: string): string => toCsv([[text(value)]]).slice(1, -2);

describe("toCsv: format", () => {
  it("börjar med UTF-8-BOM", () => {
    expect(toCsv([[text("a")]]).startsWith(BOM)).toBe(true);
  });

  it("avgränsar med ; och avslutar raderna med CRLF", () => {
    expect(toCsv([[text("a"), text("b")], [text("c")]])).toBe(`${BOM}a;b\r\nc\r\n`);
  });

  it("tom cell (null) blir ett tomt fält", () => {
    expect(toCsv([[text("a"), null, text("b")]])).toBe(`${BOM}a;;b\r\n`);
  });

  it("en tom rad blir en tom rad", () => {
    expect(toCsv([[text("a")], [], [text("b")]])).toBe(`${BOM}a\r\n\r\nb\r\n`);
  });

  it("åäö skrivs som de är", () => {
    expect(field("Rättshjälp åäö")).toBe("Rättshjälp åäö");
  });
});

describe("toCsv: citering", () => {
  it.each([
    ["a;b", '"a;b"'],
    ['a"b', '"a""b"'],
    ["a\rb", '"a\rb"'],
    ["a\nb", '"a\nb"'],
  ])("%j citeras som %j", (value, expected) => {
    expect(field(value)).toBe(expected);
  });

  it("dubblerar varje \"", () => {
    expect(field('"x" och "y"')).toBe('"""x"" och ""y"""');
  });

  it("vanlig text citeras inte", () => {
    expect(field("Klient A")).toBe("Klient A");
  });
});

describe("toCsv: formelskydd", () => {
  it.each(["=SUM(A1)", "+1+1", "-x", "@cmd", "\tflik"])("%j får ett inledande '", (value) => {
    expect(field(value)).toBe(`'${value}`);
  });

  it("CR först skyddas och citeras", () => {
    expect(field("\rx")).toBe("\"'\rx\"");
  });

  it.each(["-12", "-0,05", "1234,56", "0"])("rent tal %j skrivs som det är", (value) => {
    expect(field(value)).toBe(value);
  });

  it("talceller skyddas inte", () => {
    expect(toCsv([[num(-5)]])).toBe(`${BOM}-5\r\n`);
  });
});

describe("toCsv: talceller", () => {
  it("decimalkomma och ingen gruppering", () => {
    expect(toCsv([[num(1234567.5)]])).toBe(`${BOM}1234567,5\r\n`);
  });
});

describe("csvKrFromOre", () => {
  it.each([
    [123456, "1234,56"],
    [-5, "-0,05"],
    [0, "0,00"],
    [5, "0,05"],
    [100, "1,00"],
    [-123456, "-1234,56"],
    [123456789, "1234567,89"],
  ])("%d öre → %s", (ore, expected) => {
    expect(csvKrFromOre(ore)).toBe(expected);
  });
});

describe("csvHoursFromMinutes", () => {
  it.each([
    [90, "1,50"],
    [0, "0,00"],
    [600, "10,00"],
    [20, "0,33"],
    [6, "0,10"],
  ])("%d minuter → %s", (minutes, expected) => {
    expect(csvHoursFromMinutes(minutes)).toBe(expected);
  });
});
