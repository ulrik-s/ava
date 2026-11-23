/**
 * CSV för svenskt Excel (#1792): ren, ramverksfri serialisering av rader med
 * celler. Semikolon som avgränsare, CRLF, UTF-8-BOM, citering och formelskydd.
 * Vet ingenting om rapporter, så att varje export i klienten använder samma
 * regler (förebild: SIE-exportens rena serialisering).
 */

/** En cell: text, tal, eller `null` för ett saknat värde (tomt fält). */
export type CsvCell =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | null;

/** En rad celler. */
export type CsvRow = readonly CsvCell[];

const BOM = "﻿";
const SEPARATOR = ";";
const NEWLINE = "\r\n";
/** Text som Excel annars kan tolka som en formel. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Text som är ett rent tal (decimalkomma) skrivs som den är. */
const PLAIN_NUMBER = /^-?\d+(,\d+)?$/;
/** Text som måste citeras. */
const NEEDS_QUOTES = /[;"\r\n]/;

/** Textcell. */
export function text(value: string): CsvCell {
  return { kind: "text", value };
}

/** Talcell, skrivs med decimalkomma och utan gruppering. */
export function num(value: number): CsvCell {
  return { kind: "number", value };
}

/** Tal med decimalkomma, utan tusentalsgruppering. */
function formatNumber(value: number): string {
  return String(value).replace(".", ",");
}

/** Formelskydd: inledande `'`, utom för rena tal. */
function protect(value: string): string {
  return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
}

/** Citera med `"` och dubblera `"` när texten kräver det. */
function quote(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function serializeCell(cell: CsvCell): string {
  if (cell === null) return "";
  if (cell.kind === "number") return formatNumber(cell.value);
  return quote(protect(cell.value));
}

/** Rader → CSV-text med BOM, `;` och CRLF. */
export function toCsv(rows: readonly CsvRow[]): string {
  return BOM + rows.map((row) => row.map(serializeCell).join(SEPARATOR)).join(NEWLINE) + NEWLINE;
}

/** Ett heltal hundradelar som tal med två decimaler, med heltalsaritmetik. */
function twoDecimals(hundredths: number): string {
  const abs = Math.abs(Math.round(hundredths));
  const sign = hundredths < 0 && abs > 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Kronor med två decimaler ur heltalsöre, t.ex. 123456 → "1234,56", -5 → "-0,05". */
export function csvKrFromOre(ore: number): string {
  return twoDecimals(ore);
}

/** Timmar med två decimaler ur minuter, t.ex. 90 → "1,50". */
export function csvHoursFromMinutes(minutes: number): string {
  return twoDecimals((minutes * 100) / 60);
}
