/**
 * `booking-window` — spärr mot att bokföra utanför en tillåten period (#1035).
 *
 * ## Problemet
 *
 * Fortnox-e2e:t bokför på RIKTIGT, i ett riktigt Fortnox-konto. API:t har
 * varken DELETE eller PUT för verifikat, så ett verifikat som hamnat fel kan
 * bara städas manuellt i GUI:t — och bara bakifrån i sin serie. Ett e2e som av
 * misstag kör mot fel tenant, eller med fel datum, skriver alltså in skräp i en
 * skarp bokföring där det är dyrt att få bort.
 *
 * ## Lösningen
 *
 * CI bokför i ett EGET räkenskapsår (och en egen verifikatserie). Den här
 * modulen gör den avgränsningen till en spärr i stället för en konvention:
 * `withBookingWindow` lindar en `LedgerConnector` så att varje verifikat vars
 * transaktionsdatum faller utanför fönstret avvisas INNAN det når nätet.
 *
 * Spärren sitter medvetet på porten och inte i Fortnox-connectorn: den handlar
 * om vilken period som får bokföras, vilket är sant för varje ledger-system.
 *
 * ## Fail-closed
 *
 * `parseBookingWindow` KASTAR på saknad/trasig spec i stället för att returnera
 * "inget fönster". Ett fönster som tyst blir `null` när en env-variabel råkar
 * stavas fel vore en spärr som skyddar precis så länge ingen gör fel — alltså
 * ingen spärr alls.
 */

import { toIsoDate } from "@/lib/shared/iso-date";
import type { LedgerConnector } from "./port";

/** Tillåten bokföringsperiod, `YYYY-MM-DD` inklusive i båda ändar. */
export interface BookingWindow {
  readonly from: string;
  readonly to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SPEC_SEPARATOR = "..";

/** Exakt två ISO-datum kring separatorn — annars null. */
function splitSpec(spec: string | undefined): readonly [string, string] | null {
  const parts = (spec ?? "").split(SPEC_SEPARATOR);
  if (parts.length !== 2) return null;
  const [from, to] = parts;
  if (from === undefined || to === undefined) return null;
  return DATE_RE.test(from) && DATE_RE.test(to) ? [from, to] : null;
}

/**
 * Tolka `"2030-01-01..2030-12-31"`. Kastar med en åtgärdbar text på allt annat
 * — inklusive `undefined`, eftersom en saknad spärr är det farliga fallet.
 */
export function parseBookingWindow(spec: string | undefined): BookingWindow {
  const parts = splitSpec(spec);
  if (parts === null) {
    throw new Error(
      `Ogiltigt bokföringsfönster: ${JSON.stringify(spec ?? null)}. ` +
      `Förväntat format "YYYY-MM-DD..YYYY-MM-DD" (CI:s räkenskapsår).`,
    );
  }
  const [from, to] = parts;
  if (from > to) throw new Error(`Bokföringsfönstrets start (${from}) ligger efter dess slut (${to}).`);
  return { from, to };
}

/** Ligger datumet i fönstret? Strängjämförelse räcker — ISO-datum sorterar rätt. */
export function isWithinBookingWindow(date: Date | string, window: BookingWindow): boolean {
  const iso = toIsoDate(date);
  return iso >= window.from && iso <= window.to;
}

/** Kastar om datumet ligger utanför fönstret. */
export function assertWithinBookingWindow(date: Date | string, window: BookingWindow): void {
  if (isWithinBookingWindow(date, window)) return;
  throw new Error(
    `Bokföringsdatum ${toIsoDate(date)} ligger utanför tillåtet fönster ` +
    `${window.from}..${window.to} — verifikatet skickades inte.`,
  );
}

/** Finns datumet på riktigt? `2030-02-29` gör det inte — 2030 är inget skottår,
 *  och Fortnox avvisar ett verifikat daterat en dag som aldrig inträffar. */
function isRealDate(iso: string): boolean {
  return toIsoDate(new Date(`${iso}T00:00:00`)) === iso;
}

/**
 * Ett datum inne i fönstret att stämpla CI:s verifikat med.
 *
 * Behåller `now`:s månad och dag men flyttar året till fönstrets startår, så
 * verifikaten sprids över CI-året och går att korrelera med körningen. Duger
 * det inte — smalare fönster än ett år, eller en 29 februari som flyttats till
 * ett icke-skottår — klampas det till `from`.
 */
export function bookingDateWithin(window: BookingWindow, now: Date): string {
  if (isWithinBookingWindow(now, window)) return toIsoDate(now);
  const shifted = `${window.from.slice(0, 4)}${toIsoDate(now).slice(4)}`;
  const usable = isRealDate(shifted) && shifted >= window.from && shifted <= window.to;
  return usable ? shifted : window.from;
}

/**
 * Linda en connector med fönster-spärren. Metod-ytan bevaras exakt: bara de
 * metoder inner faktiskt har exponeras vidare, så `capabilities()`-invarianten
 * (flagga true ⟺ metod finns) håller genom dekoratören.
 */
/** Port-metoderna som passerar orörda — de skapar inga verifikat. */
const PASS_THROUGH = ["pushInvoice", "pullPayments", "exportSie"] as const;

export function withBookingWindow(inner: LedgerConnector, window: BookingWindow): LedgerConnector {
  const guarded: LedgerConnector = {
    name: inner.name,
    capabilities: () => inner.capabilities(),
  };
  const push = inner.pushVoucher?.bind(inner);
  if (push) {
    // `async` är inte kosmetika: en Promise-returnerande metod ska AVVISA, inte
    // kasta synkront. En synkron throw går förbi anroparens `.catch`/`await`-
    // hantering och hade fällt drivrutinens per-faktura-isolering.
    guarded.pushVoucher = async (voucher, ctx) => {
      assertWithinBookingWindow(voucher.date, window);
      return push(voucher, ctx);
    };
  }
  for (const method of PASS_THROUGH) {
    const fn = inner[method]?.bind(inner);
    // Bara det inner FAKTISKT har kopieras vidare, så invarianten i port.ts
    // (flagga true ⟺ metod finns) håller genom dekoratören.
    if (fn) Object.assign(guarded, { [method]: fn });
  }
  return guarded;
}
