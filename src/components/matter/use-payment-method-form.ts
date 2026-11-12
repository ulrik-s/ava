"use client";

/**
 * Formulär-state för ärendets betalningsdel (#1564), utbrutet ur
 * `PaymentMethodEditor` så att samma fält kan bäddas in i en större dialog
 * och sparas tillsammans med ärendets övriga uppgifter. Fälten hålls som
 * text (det användaren skriver) och omvandlas först när indata byggs.
 */

import { useState } from "react";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { HourlyRates } from "@/lib/shared/schemas/hourly-rates";

type DateLike = Date | string | null | undefined;

/** Ärendets sparade betalningsuppgifter — startvärdet för formuläret. */
export interface PaymentMethodInitial {
  paymentMethod: PaymentMethod;
  paymentMethodNote: string | null;
  paymentMethodDecidedAt: DateLike;
  /** Klientens andel i bips (2500 = 25 %); null = ej satt (#778). */
  clientShareBips: number | null;
  /** Rättsskyddets maxbelopp i öre; null = ej satt (#793). */
  rattsskyddMaxOre: number | null;
  /** Rättshjälpens timtak; null → 100 tim (#793). */
  rattshjalpMaxTimmar: number | null;
  tvistUppkomDatum?: DateLike;
  rattsskyddBeslutDatum?: DateLike;
  rattsskyddNekadAt?: DateLike;
  hourlyRates?: HourlyRates | undefined;
}

/** Fältens värden som de står i formuläret (text, ISO-datum, timpriskarta). */
export interface PaymentMethodFormValues {
  method: PaymentMethod;
  note: string;
  /** ISO-datum (yyyy-mm-dd) eller tomt. */
  decidedAt: string;
  /** Klientens andel i procent, komma-decimal tillåten. */
  sharePct: string;
  /** Rättsskyddets tak i kronor. */
  rsMaxKr: string;
  /** Rättshjälpens tak i timmar. */
  rhMaxTim: string;
  tvist: string;
  beslut: string;
  nekad: string;
  rates: HourlyRates;
}

/** Betalningsdelen av `matter.update`-indata. */
export interface PaymentMethodUpdateInput {
  paymentMethod: PaymentMethod;
  paymentMethodNote: string | null;
  paymentMethodDecidedAt: string | null;
  clientShareBips: number | null;
  rattsskyddMaxOre: number | null;
  rattshjalpMaxTimmar: number | null;
  tvistUppkomDatum: string | null;
  rattsskyddBeslutDatum: string | null;
  rattsskyddNekadAt: string | null;
  hourlyRates: HourlyRates;
}

/** Formulärets state, en setter och byggaren av `matter.update`-indata. */
export interface PaymentMethodForm {
  values: PaymentMethodFormValues;
  setValues: (next: PaymentMethodFormValues) => void;
  toUpdateInput: () => PaymentMethodUpdateInput;
}

/** ISO-datum (yyyy-mm-dd) ur ett valfritt datumfält, tomt om saknas. */
function isoDate(d: DateLike): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

/** Talvärde → text för ett formulärfält (delat med `divisor`); null → tomt. */
function numText(n: number | null, divisor = 1): string {
  return n != null ? String(n / divisor) : "";
}

/** Startvärden ur ärendets sparade uppgifter. */
export function paymentFormFromMatter(initial: PaymentMethodInitial): PaymentMethodFormValues {
  return {
    method: initial.paymentMethod,
    note: initial.paymentMethodNote ?? "",
    decidedAt: isoDate(initial.paymentMethodDecidedAt),
    // %-sats redigeras i procent (bips/100); tak för rättsskydd i kr (öre/100).
    sharePct: numText(initial.clientShareBips, 100),
    rsMaxKr: numText(initial.rattsskyddMaxOre, 100),
    rhMaxTim: numText(initial.rattshjalpMaxTimmar),
    tvist: isoDate(initial.tvistUppkomDatum),
    beslut: isoDate(initial.rattsskyddBeslutDatum),
    nekad: isoDate(initial.rattsskyddNekadAt),
    rates: initial.hourlyRates ?? {},
  };
}

/** Textfält → tal med komma-decimal; null om tomt/ogiltigt. */
function parseDecimal(s: string): number | null {
  const trimmed = s.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Procent-textfält → bips (null om tomt/ogiltigt eller utanför 0–100). */
function clientShareFromPct(pct: string): number | null {
  const n = parseDecimal(pct);
  return n != null && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
}

/** Kr-textfält → öre (null om tomt/ogiltigt/negativt). Mellanslag ("75 000") tillåts. */
function oreFromKr(kr: string): number | null {
  const n = parseDecimal(kr.replace(/\s/g, ""));
  return n != null && n >= 0 ? Math.round(n * 100) : null;
}

/** Heltals-textfält → positivt heltal (null om tomt/ogiltigt/≤0). */
function positiveIntOrNull(s: string): number | null {
  const n = parseDecimal(s);
  return n != null && n > 0 ? Math.round(n) : null;
}

/** Formulärets värden → betalningsdelen av `matter.update`-indata. */
export function paymentUpdateInput(v: PaymentMethodFormValues): PaymentMethodUpdateInput {
  return {
    paymentMethod: v.method,
    paymentMethodNote: v.note || null,
    paymentMethodDecidedAt: v.decidedAt || null,
    clientShareBips: clientShareFromPct(v.sharePct),
    rattsskyddMaxOre: oreFromKr(v.rsMaxKr),
    rattshjalpMaxTimmar: positiveIntOrNull(v.rhMaxTim),
    tvistUppkomDatum: v.tvist || null,
    rattsskyddBeslutDatum: v.beslut || null,
    rattsskyddNekadAt: v.nekad || null,
    hourlyRates: v.rates,
  };
}

/** Håller betalningsformulärets fält, initierade ur ärendets sparade uppgifter. */
export function usePaymentMethodForm(initial: PaymentMethodInitial): PaymentMethodForm {
  const [values, setValues] = useState(() => paymentFormFromMatter(initial));
  return { values, setValues, toUpdateInput: () => paymentUpdateInput(values) };
}
