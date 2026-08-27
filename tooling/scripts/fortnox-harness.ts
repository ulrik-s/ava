/**
 * Gemensam uppsättning för Fortnox-skripten (#1035).
 *
 * `fortnox-e2e.ts`, `fortnox-bookkeeping-e2e.ts` och `fortnox-series.ts` läser
 * samma env, bygger samma config och samma kontomappning. Tre kopior av det
 * hade betytt tre ställen att glömma bokföringsfönstret på — och fönstret är
 * hela spärren mot att skriva skräp i en skarp bokföring.
 *
 * Env (se docs/fortnox-e2e.md):
 *   AVA_FORTNOX_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN   obligatoriska
 *   AVA_FORTNOX_BOOKING_WINDOW   "YYYY-MM-DD..YYYY-MM-DD" — CI:s räkenskapsår
 *   AVA_FORTNOX_VOUCHER_SERIES   CI:s egen serie (default "A")
 *   AVA_FORTNOX_KONTO_*          kontomappning, se DEFAULT_MAPPING
 *   AVA_FORTNOX_ACCOUNT_TYPE     "service" → service-konto i st.f. användarsamtycke
 */

import { appendFileSync } from "node:fs";
import { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import {
  fortnoxConfigSchema, fortnoxKontoMappningSchema,
  type FortnoxConfig, type FortnoxKontoMappning,
} from "@/lib/server/integrations/fortnox/schema";
import { InMemoryFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";
import { bookingDateWithin, parseBookingWindow, type BookingWindow } from "@/lib/server/integrations/ledger/booking-window";

/** Obligatorisk env — avbryter med exit 2 och en läsbar hänvisning. */
export function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} saknas. Se docs/fortnox-e2e.md för vilka secrets som krävs.`);
    process.exit(2);
  }
  return v;
}

/** BAS-kontoplanens standardkonton — byrån överstyr via env. */
const DEFAULT_MAPPING = { voucherSeries: "A", kundfordran: "1510", intaktArvode: "3041", momsUtgaende: "2611" };

export function buildConfig(): FortnoxConfig {
  return fortnoxConfigSchema.parse({
    clientId: required("AVA_FORTNOX_CLIENT_ID"),
    clientSecret: required("AVA_FORTNOX_CLIENT_SECRET"),
    // Redirect-URI:n används bara i authorize-steget (som redan är gjort) —
    // refresh bryr sig inte om den, men schemat kräver ett giltigt värde.
    redirectUri: process.env.AVA_FORTNOX_REDIRECT_URI ?? "https://localhost/callback",
    scopes: ["bookkeeping"],
    ...(process.env.AVA_FORTNOX_ACCOUNT_TYPE === "service" ? { accountType: "service" as const } : {}),
  });
}

export function buildMapping(): FortnoxKontoMappning {
  const overrides: Record<string, string | undefined> = {
    voucherSeries: process.env.AVA_FORTNOX_VOUCHER_SERIES,
    kundfordran: process.env.AVA_FORTNOX_KONTO_KUNDFORDRAN,
    intaktArvode: process.env.AVA_FORTNOX_KONTO_ARVODE,
    momsUtgaende: process.env.AVA_FORTNOX_KONTO_MOMS,
  };
  const set = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return fortnoxKontoMappningSchema.parse({ ...DEFAULT_MAPPING, ...set });
}

/**
 * CI:s bokföringsfönster. KASTAR om `AVA_FORTNOX_BOOKING_WINDOW` saknas —
 * spärren ska inte gå att komma runt genom att glömma en variabel.
 */
export function bookingWindow(): BookingWindow {
  return parseBookingWindow(process.env.AVA_FORTNOX_BOOKING_WINDOW);
}

/** Datum inne i fönstret att stämpla körningens verifikat med. */
export function ciBookingDate(window: BookingWindow, now: Date = new Date()): string {
  return bookingDateWithin(window, now);
}

/**
 * Klient med utgången access-token, så första anropet TVINGAS refresha. Det är
 * precis det vi vill verifiera — och det som roterar refresh-token:en.
 */
export function connect(config: FortnoxConfig): { client: FortnoxClient; store: InMemoryFortnoxTokenStore } {
  const store = new InMemoryFortnoxTokenStore({
    accessToken: "utgången", refreshToken: required("AVA_FORTNOX_REFRESH_TOKEN"), accessTokenExpiresAt: 0,
  });
  return { client: new FortnoxClient(config, store), store };
}

/**
 * Skriv den roterade refresh-token:en till `$GITHUB_OUTPUT`. ALDRIG till
 * stdout — GitHub maskerar bara det den känner till. Anropas direkt efter
 * första refreshen: den gamla token:en är död från den sekunden, så tappas den
 * nya kan nästa körning inte auth:a alls.
 */
export async function emitRotatedToken(store: InMemoryFortnoxTokenStore): Promise<void> {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const rotated = await store.load();
  if (!rotated) return;
  appendFileSync(out, `refresh_token=${rotated.refreshToken}\n`);
  console.log("• Roterad refresh-token skriven till GITHUB_OUTPUT (maskerad).");
}
