/**
 * Släppet av en makulerad eller krediterad fakturas poster (#2260) — SAMMA
 * scenarier mot minnesrepona och Drizzle-repona (kontraktet, #1249).
 *
 * Regeln är `releasePatch`: fakturans egen koppling nollas, och frysningen
 * nollas när en släppt körning frös posten och posten inte hör till en annan
 * faktura. En kostnadsräknings frysning står kvar. Båda backends måste ge
 * exakt samma rader — annars syns posterna under Fakturera i klienten men inte
 * på servern, eller tvärtom.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { BillingRun } from "@/lib/shared/schemas/billing";
import { asId, type BillingRunId, type InvoiceId, type MatterId } from "@/lib/shared/schemas/ids";
import { releasePatch, type LockableEntry } from "@/lib/shared/time-entry-lock";
import { uuidv7 } from "@/lib/shared/uuid";
import { DRIZZLE_NAME, openDrizzleRepos, openInMemoryRepos, type OpenRepos } from "./contract-backends";

const at = new Date("2026-11-28T08:00:00.000Z");

interface World {
  matter: MatterId; user: string;
  invoice: InvoiceId; other: InvoiceId;
  run: BillingRunId; krRun: BillingRunId;
}

async function makeWorld(repos: Repositories): Promise<World> {
  const w: World = {
    matter: asId(uuidv7()), user: uuidv7(), invoice: asId(uuidv7()), other: asId(uuidv7()),
    run: asId(uuidv7()), krRun: asId(uuidv7()),
  };
  const org = uuidv7();
  await repos.users.create({ id: w.user, organizationId: org, email: `${w.user}@byra.se`, name: "Lena", role: "LAWYER" } as never);
  await repos.matters.create({ id: w.matter, organizationId: org, matterNumber: "2026-2260", title: "Gör om", status: "ACTIVE" } as never);
  for (const id of [w.invoice, w.other]) {
    await repos.invoices.create({ id, matterId: w.matter, amount: 100_000, invoiceDate: at, status: "DRAFT" } as never);
  }
  const run = { matterId: w.matter, recipient: "KLIENT", status: "SENT", workValueOreAtRun: 1, proposedAmountOre: 1, amountOre: 1, deductedBillingRunIds: [], periodTo: at };
  await repos.billingRuns.create({ id: w.run, ...run, type: "FINAL", invoiceId: w.invoice } as never);
  await repos.billingRuns.create({ id: w.krRun, ...run, type: "KOSTNADSRAKNING", invoiceId: null } as never);
  return w;
}

/** Postens låsfält före släppet, och vad regeln säger ska bli kvar efter. */
interface Case { name: string; lock: (w: World) => LockableEntry }

const CASES: readonly Case[] = [
  { name: "fakturerad och fryst av den släppta körningen", lock: (w) => ({ invoiceId: w.invoice, frozenAt: at, frozenByBillingRunId: w.run }) },
  { name: "fryst av den släppta körningen, ej debiterbar (utan faktura)", lock: (w) => ({ invoiceId: null, frozenAt: at, frozenByBillingRunId: w.run }) },
  { name: "kopplad till fakturan utan körning", lock: (w) => ({ invoiceId: w.invoice, frozenAt: null, frozenByBillingRunId: null }) },
  { name: "kopplad till fakturan men fryst av en kostnadsräkning", lock: (w) => ({ invoiceId: w.invoice, frozenAt: at, frozenByBillingRunId: w.krRun }) },
  { name: "en annan fakturas post", lock: (w) => ({ invoiceId: w.other, frozenAt: at, frozenByBillingRunId: w.run }) },
  { name: "olåst post", lock: () => ({ invoiceId: null, frozenAt: null, frozenByBillingRunId: null }) },
];

/** Låsfälten normaliserade (datum som tid, saknat som null) — jämförbara mellan backends. */
function norm(row: LockableEntry | null): Record<string, unknown> {
  const frozenAt = row?.frozenAt == null ? null : new Date(row.frozenAt).getTime();
  return { invoiceId: row?.invoiceId ?? null, frozenAt, frozenByBillingRunId: row?.frozenByBillingRunId ?? null };
}

const ROWS = {
  timeEntries: (w: World) => ({ userId: w.user, matterId: w.matter, date: at, minutes: 30, description: "Samtal", hourlyRate: 150_000 }),
  expenses: (w: World) => ({ userId: w.user, matterId: w.matter, date: at, amount: 10_000, description: "Resa", billable: true }),
} as const;

const BACKENDS: ReadonlyArray<{ name: string; open: () => Promise<OpenRepos> }> = [
  { name: "in-memory", open: () => Promise.resolve(openInMemoryRepos()) },
  { name: DRIZZLE_NAME, open: () => openDrizzleRepos() },
];

for (const backend of BACKENDS) {
  describe(`släpp av fakturans poster — ${backend.name}`, () => {
    let repos: Repositories;
    let close: () => Promise<void> = async () => {};
    beforeAll(async () => { ({ repos, close } = await backend.open()); });
    afterAll(async () => { await close(); });

    for (const kind of ["timeEntries", "expenses"] as const) {
      it(`${kind}: varje fall blir som releasePatch säger`, async () => {
        const w = await makeWorld(repos);
        const release = { invoiceId: w.invoice, billingRunIds: [w.run] };
        const ids = CASES.map(() => uuidv7());
        for (const [i, c] of CASES.entries()) await repos[kind].create({ id: asId(ids[i] ?? ""), ...ROWS[kind](w), ...c.lock(w) } as never);
        await repos[kind].releaseInvoice(release);
        for (const [i, c] of CASES.entries()) {
          const before = c.lock(w);
          const expected = norm({ ...before, ...releasePatch(before, release) });
          expect({ fall: c.name, ...norm(await repos[kind].getById(asId(ids[i] ?? ""))) }).toEqual({ fall: c.name, ...expected });
        }
      });

      it(`${kind}: utan släppta körningar nollas bara kopplingen till fakturan`, async () => {
        const w = await makeWorld(repos);
        const id = uuidv7();
        await repos[kind].create({ id: asId(id), ...ROWS[kind](w), invoiceId: w.invoice, frozenAt: at, frozenByBillingRunId: w.run } as never);
        await repos[kind].releaseInvoice({ invoiceId: w.invoice, billingRunIds: [] });
        expect(norm(await repos[kind].getById(asId(id)))).toEqual({ invoiceId: null, frozenAt: at.getTime(), frozenByBillingRunId: w.run });
      });

      it(`${kind}: släppta poster syns igen som ofrysta och kan faktureras`, async () => {
        const w = await makeWorld(repos);
        const id = uuidv7();
        await repos[kind].create({ id: asId(id), ...ROWS[kind](w), invoiceId: w.invoice, frozenAt: at, frozenByBillingRunId: w.run } as never);
        expect((await repos[kind].listUnfrozenForMatter(w.matter)).map((r) => r.id)).not.toContain(id);
        await repos[kind].releaseInvoice({ invoiceId: w.invoice, billingRunIds: [w.run] });
        expect((await repos[kind].listUnfrozenForMatter(w.matter)).map((r) => r.id)).toContain(id);
        expect((await repos[kind].listUnbilled(w.matter, [asId(id)])).map((r) => r.id)).toEqual([id]);
      });
    }

    it("billingRuns.listByInvoice: körningarna som pekar på fakturan, utan raderade", async () => {
      const w = await makeWorld(repos);
      const gone = asId<"BillingRunId">(uuidv7());
      const run: Partial<BillingRun> = { matterId: w.matter, type: "ACCONTO", recipient: "KLIENT", status: "SENT", workValueOreAtRun: 1, proposedAmountOre: 1, amountOre: 1, deductedBillingRunIds: [], periodTo: at, invoiceId: w.invoice };
      await repos.billingRuns.create({ id: gone, ...run });
      await repos.billingRuns.softDelete(gone);
      expect((await repos.billingRuns.listByInvoice(w.invoice)).map((r) => r.id)).toEqual([w.run]);
      expect(await repos.billingRuns.listByInvoice(w.other)).toEqual([]);
    });
  });
}
