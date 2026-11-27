/**
 * Hjälp för egenskapstester som ska ge samma svar i alla processens tidszoner
 * (servern kör i UTC, utvecklarna i Stockholm): zonerna, en körning i en zon och
 * rena kalenderdagar att slumpa (#1677, #2108).
 */

import fc from "fast-check";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Ett rent datum "YYYY-MM-DD" (UTC-midnatt) från `minYear` till och med `maxYear`. */
export function plainDateBetween(minYear: number, maxYear: number): fc.Arbitrary<string> {
  return fc
    .date({ min: new Date(Date.UTC(minYear, 0, 1)), max: new Date(Date.UTC(maxYear, 11, 31)), noInvalidDate: true })
    .map((d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
}

/** Zoner långt från Stockholm åt båda hållen, halv- och kvartstimmar, egen sommartid. */
export const PROCESS_ZONES = [
  "UTC", "Europe/Stockholm", "America/Los_Angeles", "America/St_Johns", "Asia/Tokyo",
  "Asia/Kathmandu", "Australia/Lord_Howe", "Pacific/Kiritimati", "Pacific/Pago_Pago",
] as const;

/**
 * Kör `fn` med processens tidszon satt till `tz` och återställ efteråt. Bun läser
 * om `process.env.TZ` vid varje tilldelning (https://bun.com/docs/test/dates-times);
 * `bun test` kör annars i Etc/UTC. Återställ med en TILLDELNING — efter
 * `delete process.env.TZ` slår senare tilldelningar inte längre igenom i Bun 1.3.
 */
export function inProcessZone<T>(tz: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = original ?? "Etc/UTC";
  }
}
