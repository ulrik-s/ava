/**
 * Slumpade ärenden för egenskapstesterna (#1255): ett ärende per betalningssätt
 * med tidsposter, utlägg och — för offentligt uppdrag — huvudförhandling och
 * taxa, kört genom de riktiga routrarna mot ett minneslager.
 */

import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { TAXA_MAX_MINUTES, type TaxaLevel } from "@/lib/shared/brottmalstaxa";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import type { Rng } from "../../../helpers/seeded-rng";

/** Betalningssätten egenskaperna gäller. */
export type ScenarioMethod = "OFFENTLIGT_UPPDRAG" | "RATTSHJALP" | "RATTSSKYDD" | "PRIVAT";

type Kind = "ARBETE" | "TIDSSPILLAN" | "ADVOKATBEREDSKAP";

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

/** Datum i innevarande år, före idag — samma års normer som yrkandet. */
function dateThisYear(r: Rng): Date {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  return new Date(start + Math.floor(r.next() * Math.max(1, now.getTime() - start - 86_400_000)));
}

function kindsFor(method: ScenarioMethod): readonly Kind[] {
  return method === "OFFENTLIGT_UPPDRAG" ? ["ARBETE", "TIDSSPILLAN", "ADVOKATBEREDSKAP"] : ["ARBETE", "TIDSSPILLAN"];
}

function entry(r: Rng, method: ScenarioMethod, i: number): ScenarioEntry {
  const kind = r.pick(kindsFor(method)) ?? "ARBETE";
  return {
    id: `te-${i}`, organizationId: ORG, userId: USER, matterId: MATTER, date: dateThisYear(r),
    // Beredskap räknas per dygn, inte per minut.
    minutes: kind === "ADVOKATBEREDSKAP" ? 0 : 6 * r.int(1, 100),
    description: `Post ${i}`, hourlyRate: 100 * r.int(1_000, 3_500), billable: true, kind,
  };
}

function expense(r: Rng, i: number): ScenarioExpense {
  return {
    id: `ex-${i}`, organizationId: ORG, userId: USER, matterId: MATTER, date: dateThisYear(r),
    amount: r.int(100, 500_000), description: `Utlägg ${i}`, billable: true,
    vatRate: r.pick([0, 600, 2500]) ?? 2500, vatIncluded: r.next() < 0.5, passThrough: r.next() < 0.25,
  };
}

function hufFor(r: Rng): { hufStart: string; hufEnd: string } {
  const start = Date.UTC(2026, 8, 22, 9, 0);
  return { hufStart: new Date(start).toISOString(), hufEnd: new Date(start + r.int(0, TAXA_MAX_MINUTES) * 60_000).toISOString() };
}

/** Slumpa ett ärende för betalningssättet. */
export function scenarioFor(r: Rng, method: ScenarioMethod): Scenario {
  const entries = Array.from({ length: r.int(1, 6) }, (_, i) => entry(r, method, i));
  const expenses = Array.from({ length: r.int(0, 3) }, (_, i) => expense(r, i));
  return {
    method, entries, expenses,
    isTaxe: method === "OFFENTLIGT_UPPDRAG" && r.next() < 0.5,
    taxaLevel: (r.pick([1, 2, 3, 4] as const) ?? 1),
    huf: hufFor(r),
    clientShareBips: method === "RATTSHJALP" || method === "RATTSSKYDD" ? 100 * r.int(2, 40) : 0,
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
