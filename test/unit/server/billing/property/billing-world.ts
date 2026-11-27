/**
 * Slumpade ärenden för egenskapstesterna (#1255): ett ärende per betalningssätt
 * med tidsposter, utlägg och — för offentligt uppdrag — huvudförhandling och
 * taxa, kört genom de riktiga routrarna mot ett minneslager.
 */

import { Temporal } from "@js-temporal/polyfill";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { TAXA_MAX_MINUTES, type TaxaLevel } from "@/lib/shared/billing/brottmalstaxa";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { STOCKHOLM_TZ } from "@/lib/shared/stockholm-time";
import { rng, type Rng } from "../../../helpers/seeded-rng";

/** Betalningssätten egenskaperna gäller. */
export type ScenarioMethod = "OFFENTLIGT_UPPDRAG" | "RATTSHJALP" | "RATTSSKYDD" | "PRIVAT";

type Kind = "ARBETE" | "TIDSSPILLAN" | "TIDSSPILLAN_OVRIG_TID" | "ADVOKATBEREDSKAP" | "FORHOR";

export type ScenarioEntry = {
  id: string; organizationId: string; userId: string; matterId: string; date: Date;
  minutes: number; description: string; hourlyRate: number; billable: boolean; kind: Kind;
};

export type ScenarioExpense = {
  id: string; organizationId: string; userId: string; matterId: string; date: Date;
  amount: number; description: string; billable: boolean; vatRate: number; vatIncluded: boolean;
  /** Äkta utlägg (t.ex. ansökningsavgift): vidarefaktureras utan moms. */
  passThrough: boolean;
};

/** Ett slumpat ärende. `huf`/`taxaLevel`/`isTaxe` används bara av offentligt uppdrag. */
export interface Scenario {
  method: ScenarioMethod;
  isTaxe: boolean;
  taxaLevel: TaxaLevel;
  huf: { hufStart: string; hufEnd: string };
  clientShareBips: number;
  entries: ScenarioEntry[];
  expenses: ScenarioExpense[];
}

const ORG = "org-1";
const USER = "u-1";
const MATTER = asId<"MatterId">("m-1");
const PRINCIPAL: Principal = {
  id: asId<"UserId">(USER), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">(ORG),
};

const DAY_MS = 86_400_000;
const QUARTER_MS = 15 * 60_000;
/** Spannet för seedens "nu": båda åren har kända normer, och årsskiftet ingår. */
const NOW_FROM = Date.UTC(2025, 0, 15);
const NOW_TO = Date.UTC(2026, 11, 31);

/**
 * Seedens "nu", slumpat ur seeden mellan 2025-01-15 och 2026-12-31. Testerna
 * fryser klockan på det (`vi.setSystemTime`), så att en seed återskapar även
 * fakturadatum, normår och serieår.
 */
export function nowFor(r: Rng): Date {
  return new Date(NOW_FROM + Math.floor(r.next() * (NOW_TO - NOW_FROM)));
}

/** Datum i `now`:s år, före idag — samma års normer som yrkandet. */
function dateThisYear(r: Rng, now: Date): Date {
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  return new Date(start + Math.floor(r.next() * Math.max(1, now.getTime() - start - DAY_MS)));
}

const KINDS: readonly Kind[] = ["ARBETE", "TIDSSPILLAN", "TIDSSPILLAN_OVRIG_TID"];

function kindsFor(method: ScenarioMethod): readonly Kind[] {
  return method === "OFFENTLIGT_UPPDRAG" ? [...KINDS, "ADVOKATBEREDSKAP"] : KINDS;
}

function entry(r: Rng, kinds: readonly Kind[], now: Date, i: number): ScenarioEntry {
  const kind = r.pick(kinds) ?? "ARBETE";
  return {
    id: `te-${i}`, organizationId: ORG, userId: USER, matterId: MATTER, date: dateThisYear(r, now),
    // Beredskap räknas per dygn, inte per minut.
    minutes: kind === "ADVOKATBEREDSKAP" ? 0 : 6 * r.int(1, 100),
    description: `Post ${i}`, hourlyRate: 100 * r.int(1_000, 3_500), billable: true, kind,
  };
}

function expense(r: Rng, now: Date, i: number): ScenarioExpense {
  return {
    id: `ex-${i}`, organizationId: ORG, userId: USER, matterId: MATTER, date: dateThisYear(r, now),
    amount: r.int(100, 500_000), description: `Utlägg ${i}`, billable: true,
    vatRate: r.pick([0, 600, 2500]) ?? 2500, vatIncluded: r.next() < 0.5, passThrough: r.next() < 0.25,
  };
}

/**
 * Håller starten i `now`:s år och före `now`: på årets första dygn kan den
 * slumpade kvarten annars hamna efter `now`, och kl. 00 svensk tid den 1 januari
 * ligger i förra årets UTC. Hela kvartar i UTC är hela kvartar i svensk tid.
 */
function startBeforeNow(start: number, now: Date): number {
  const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1);
  const lastQuarter = Math.floor((now.getTime() - 1) / QUARTER_MS) * QUARTER_MS;
  return Math.max(yearStart, Math.min(start, lastQuarter));
}

/**
 * Huvudförhandlingen: valfri veckodag i `now`:s år (före `now`), start i hela
 * kvartar över dygnet i svensk tid, och längd 0 till `TAXA_MAX_MINUTES`.
 */
function hufFor(r: Rng, now: Date): { hufStart: string; hufEnd: string } {
  const day = Temporal.Instant.fromEpochMilliseconds(dateThisYear(r, now).getTime()).toZonedDateTimeISO("UTC").toPlainDate();
  const quarter = r.int(0, 95);
  const plainTime = new Temporal.PlainTime(Math.floor(quarter / 4), (quarter % 4) * 15);
  const start = startBeforeNow(day.toZonedDateTime({ timeZone: STOCKHOLM_TZ, plainTime }).epochMilliseconds, now);
  return { hufStart: new Date(start).toISOString(), hufEnd: new Date(start + r.int(0, TAXA_MAX_MINUTES) * 60_000).toISOString() };
}

/** Slumpa ett ärende för betalningssättet, med seedens `now` (se `nowFor`). */
export function scenarioFor(r: Rng, method: ScenarioMethod, now: Date): Scenario {
  const entries = Array.from({ length: r.int(1, 6) }, (_, i) => entry(r, kindsFor(method), now, i));
  const expenses = Array.from({ length: r.int(0, 3) }, (_, i) => expense(r, now, i));
  return {
    method, entries, expenses,
    isTaxe: method === "OFFENTLIGT_UPPDRAG" && r.next() < 0.5,
    taxaLevel: (r.pick([1, 2, 3, 4] as const) ?? 1),
    huf: hufFor(r, now),
    clientShareBips: method === "RATTSHJALP" || method === "RATTSSKYDD" ? 100 * r.int(2, 40) : 0,
  };
}

/**
 * Taxe-ärende i offentligt uppdrag utan utlägg och beredskap (#1812): bara
 * taxan och tidsspillan, så att yrkandet kan räknas för hand ur posterna.
 */
export function taxeScenarioFor(r: Rng, now: Date): Scenario {
  const entries = Array.from({ length: r.int(1, 6) }, (_, i) => entry(r, KINDS, now, i));
  return {
    method: "OFFENTLIGT_UPPDRAG", entries, expenses: [], isTaxe: true,
    taxaLevel: (r.pick([1, 2, 3, 4] as const) ?? 1),
    huf: hufFor(r, now),
    clientShareBips: 0,
  };
}

/** Ärendet i ett minneslager, med en anropare som går genom de riktiga routrarna. */
export interface BillingWorld {
  matterId: MatterId;
  caller: ReturnType<typeof appRouter.createCaller>;
}

export function worldFor(s: Scenario): BillingWorld {
  const ds = new DemoDataStore({
    organizations: [{ id: ORG, name: "Byrån" }],
    users: [{ id: USER, organizationId: ORG, email: "a@x", name: "Anna", role: "ADMIN" }],
    matters: [{
      id: MATTER, organizationId: ORG, matterNumber: "2026-0001", title: "Ärende", status: "ACTIVE",
      paymentMethod: s.method, isTaxeArende: s.isTaxe, taxaLevel: s.taxaLevel, clientShareBips: s.clientShareBips,
      createdAt: new Date(),
    }],
    timeEntries: s.entries,
    expenses: s.expenses,
  }, async () => { /* skrivbart lager */ });
  return { matterId: MATTER, caller: appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL })) };
}

/**
 * Slumpkällan för delvis bifall (#1811): en egen ström per seed, så att de
 * befintliga ärendena (fullt bifall) är desamma som före #1811.
 */
export function partialRngFor(seed: number): Rng {
  return rng(seed + 1_000_000);
}

/** Avrundat nedåt till hela kronor. */
const floorKr = (ore: number): number => Math.floor(ore / 100) * 100;

/**
 * Offentligt uppdrag: domstolens prutning i hela kronor, 0 < prutning ≤ yrkat,
 * med `share` i [0, 1) som andel av yrkandet.
 */
export function partialPruningOre(claimedOre: number, share: number): number {
  if (claimedOre < 100) throw new Error(`yrkandet ${claimedOre} öre räcker inte till en prutning i hela kronor`);
  return Math.min(floorKr(claimedOre), Math.max(100, floorKr(claimedOre * share)));
}

/**
 * Rättshjälp: beviljat i hela kronor i [0, kr(0,95 × yrkat)], med `share` i
 * [0, 1). Taket 95 % håller nedsättningen större än arvodesradens avrundning
 * (se #1811).
 */
export function partialAwardOre(claimedOre: number, share: number): number {
  const cap = Math.floor((claimedOre * 0.95 + 50) / 100) * 100;
  return floorKr(cap * share);
}

/** Ett ärende med delvis bifall: ärendet och andelen (`share` i [0, 1)) ur `rp`. */
export function partialCaseFor(rp: Rng, method: "OFFENTLIGT_UPPDRAG" | "RATTSHJALP", now: Date): { s: Scenario; share: number } {
  const s = scenarioFor(rp, method, now);
  return { s, share: rp.next() };
}

/** Förordnandemålens egen slumpström (#1857), så att de andra fallen inte ändras. */
export function forordnandeRngFor(seed: number): Rng {
  return rng(seed + 2_000_000);
}

const AVSLUT = ["NEDLAGD", "STRAFFORELAGGANDE", "INGET_ATAL"] as const;

/**
 * Förordnandemål (#1857): offentligt uppdrag med 0–3 förhör (tidsposter med
 * kategorin FORHOR) på slumpade tider, så att förhören hamnar både inom och
 * utanför taxan, och ett slumpat avslut.
 */
export function forordnandeCaseFor(rf: Rng, now: Date): { s: Scenario; avslut: (typeof AVSLUT)[number] } {
  const s = scenarioFor(rf, "OFFENTLIGT_UPPDRAG", now);
  const forhor = Array.from({ length: rf.int(0, 3) }, (_, i): ScenarioEntry => ({
    ...entry(rf, KINDS, now, s.entries.length + i), kind: "FORHOR", minutes: 6 * rf.int(1, 40),
  }));
  return { s: { ...s, entries: [...s.entries, ...forhor] }, avslut: rf.pick(AVSLUT) ?? "NEDLAGD" };
}
