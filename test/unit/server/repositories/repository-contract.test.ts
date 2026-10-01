/**
 * Kontraktstester för repositoryn (#1249) — SAMMA scenarier mot in-memory-
 * (browser/offline) och Drizzle-implementationen (Postgres via pglite).
 *
 * Varje entitet har två repo-implementationer. Skillnader mellan dem ger tysta
 * fel: en rad som finns i klienten men inte på servern, en borttagning som
 * bara gäller på ena sidan. Här måste båda klara samma kontrakt:
 *
 *   - skapa → läsa tillbaka, med id:t klienten gav,
 *   - uppdatera → fältet ändras och versionen höjs (optimistisk concurrency),
 *   - mjuk borttagning → raden syns inte längre,
 *   - byrån ur radens egen kolumn (`organizationOf`),
 *   - byråavgränsning (`getByIdInOrg`) och frysning av poster,
 *   - byrån för ärende-/faktura-/dokumentavgränsade rader (#1358): Drizzle
 *     härleder den via föräldern, minnesvägen (en byrå, ingen synk-push)
 *     svarar bara ur radens egen kolumn,
 *   - paritet change_log ↔ MutationEvent (#1358): samma skrivning ger samma
 *     entitet, rad, operation och version i båda — det är vad pull och kön
 *     bygger på,
 *   - hård radering: raden är borta och loggas som `delete`.
 *
 * Kontraktet genereras ur `ENTITY_REGISTRY`: en ny synkad entitet utan
 * fixtur här fäller testet, så nästa repo-par inte kan glida isär otestat.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { ENTITY_NAME_BY_SOURCE_KEY } from "@/lib/server/data-store/in-memory/entity-source-keys";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import type { ChangeLogEntry } from "@/lib/server/repositories/change-log-recorder";
import { enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { EntityRepo } from "@/lib/server/sync/entity-repo";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

type Row = Record<string, unknown>;
type RepoKey = keyof Omit<Repositories, "transaction" | "transactionWithDb">;

/** Förälder-raderna varje fixtur kan peka på (skapas per backend). */
interface Parents {
  org: string; otherOrg: string; user: string; matter: string; contact: string;
  invoice: string; invoice2: string; plan: string; document: string;
  /** En faktura utan plan — planens `invoiceId` är unikt. */
  freeInvoice: string;
}

interface Fixture {
  row: (p: Parents) => Row;
  /** Ett fält att ändra, och dess nya värde. */
  patch: Row;
  /** Har raden en egen byråkolumn (då ger båda `organizationOf` samma svar)? */
  orgColumn?: boolean;
}

const at = new Date("2026-09-30T08:00:00.000Z");

/** Ersätts per backend med `invoice` (ett annat giltigt aconto-id). */
const p2Placeholder = "__invoice__";

/** En fixtur per repo. Täckningen mot ENTITY_REGISTRY kontrolleras nedan. */
const FIXTURES: Readonly<Record<RepoKey, Fixture>> = {
  organizations: { row: () => ({ name: "Kontraktsbyrån" }), patch: { name: "Nytt namn" } },
  offices: { row: (p) => ({ organizationId: p.org, name: "Göteborg" }), patch: { name: "Malmö" }, orgColumn: true },
  users: { row: (p) => ({ organizationId: p.org, email: `${uuidv7()}@byra.se`, name: "Lena", role: "LAWYER" }), patch: { name: "Lena L" }, orgColumn: true },
  contacts: { row: (p) => ({ organizationId: p.org, name: "Klient AB", contactType: "FORETAG" }), patch: { name: "Klient AB (nytt namn)" }, orgColumn: true },
  matters: { row: (p) => ({ organizationId: p.org, matterNumber: `2026-${uuidv7().slice(-4)}`, title: "Kontrakt", status: "ACTIVE" }), patch: { title: "Kontrakt 2" }, orgColumn: true },
  matterContacts: { row: (p) => ({ matterId: p.matter, contactId: p.contact, role: "KLIENT" }), patch: { role: "MOTPART" } },
  timeEntries: { row: (p) => ({ userId: p.user, matterId: p.matter, date: at, minutes: 30, description: "Samtal", hourlyRate: 150_000 }), patch: { minutes: 45 } },
  expenses: { row: (p) => ({ userId: p.user, matterId: p.matter, date: at, amount: 10_000, description: "Resa", billable: true }), patch: { amount: 12_000 } },
  invoices: { row: (p) => ({ matterId: p.matter, amount: 100_000, invoiceDate: at, status: "DRAFT" }), patch: { amount: 90_000 } },
  payments: { row: (p) => ({ invoiceId: p.invoice, amount: 1_000, paidAt: at, recordedById: p.user }), patch: { amount: 2_000 } },
  writeOffs: { row: (p) => ({ invoiceId: p.invoice, amount: 1_000, writtenOffAt: at, recordedById: p.user }), patch: { amount: 1_500 } },
  invoiceDispatches: { row: (p) => ({ invoiceId: p.invoice, channel: "EMAIL", recipient: "klient@ab.se", queuedAt: at, recordedById: p.user, status: "QUEUED" }), patch: { recipient: "ny@ab.se" } },
  paymentPlans: { row: (p) => ({ invoiceId: p.freeInvoice, monthlyAmount: 10_000, dayOfMonth: 25, startDate: at, status: "ACTIVE" }), patch: { monthlyAmount: 12_000 } },
  paymentPlanReminders: { row: (p) => ({ planId: p.plan, dueMonth: "2026-09", type: "DUE", sentAt: at }), patch: { dueMonth: "2026-10" } },
  accontoDeductions: { row: (p) => ({ finalInvoiceId: p.invoice, accontoInvoiceId: p.invoice2 }), patch: { accontoInvoiceId: p2Placeholder } },
  billingRuns: {
    row: (p) => ({ matterId: p.matter, type: "ACCONTO", recipient: "KLIENT", status: "SENT", workValueOreAtRun: 1_000, proposedAmountOre: 500, amountOre: 500, deductedBillingRunIds: [], periodTo: at }),
    patch: { amountOre: 600 },
  },
  expectedReceivables: {
    row: (p) => ({ organizationId: p.org, matterId: p.matter, description: "Domstolen", expectedAmount: 50_000, recordedById: p.user, status: "PENDING" }),
    patch: { expectedAmount: 45_000 }, orgColumn: true,
  },
  documentFolders: { row: (p) => ({ matterId: p.matter, name: "Inlagor", parentId: null }), patch: { name: "Inlagor 2" } },
  documents: {
    row: (p) => ({ matterId: p.matter, fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "documents/content/a", uploadedById: p.user }),
    patch: { fileName: "b.pdf" },
  },
  documentParts: {
    row: (p) => ({ documentId: p.document, matterId: p.matter, ordinal: 0, kind: "KALLELSE", fromPage: 1, toPage: 1, source: "AUTO" }),
    patch: { kind: "STAMNING" },
  },
  documentAnalysisSuggestions: { row: (p) => ({ documentId: p.document, name: "Anna", role: "MOTPART", contactType: "PRIVATPERSON" }), patch: { name: "Anna A" } },
  matterEventSuggestions: { row: (p) => ({ documentId: p.document, matterId: p.matter, title: "Huvudförhandling", startAt: at }), patch: { title: "Muntlig förberedelse" } },
  calendarEvents: { row: (p) => ({ organizationId: p.org, userId: p.user, title: "Möte", startAt: at }), patch: { title: "Möte 2" }, orgColumn: true },
  tasks: { row: (p) => ({ organizationId: p.org, userId: p.user, title: "Ring klienten" }), patch: { title: "Mejla klienten" }, orgColumn: true },
  serviceNotes: { row: (p) => ({ organizationId: p.org, matterId: p.matter, authorId: p.user, date: "2026-09-30", time: "10:00", text: "Samtal" }), patch: { text: "Samtal 2" }, orgColumn: true },
  // Som routern skapar den: med byrån (annars når raden aldrig change_log).
  userPreferences: { row: (p) => ({ userId: p.user, organizationId: p.org, key: `k-${uuidv7()}`, prefs: { a: 1 } }), patch: { prefs: { a: 2 } }, orgColumn: true },
  orgPreferences: { row: (p) => ({ organizationId: p.org, key: `k-${uuidv7()}`, prefs: { a: 1 } }), patch: { prefs: { a: 2 } }, orgColumn: true },
  documentTemplates: { row: (p) => ({ organizationId: p.org, name: "Fullmakt", content: "Text", createdById: p.user }), patch: { name: "Fullmakt 2" }, orgColumn: true },
  conflictChecks: { row: (p) => ({ organizationId: p.org, searchTerm: "Anna", searchType: "NAME", checkedById: p.user }), patch: { searchTerm: "Anna A" } },
};

function resolvePatch(patch: Row, p: Parents): Row {
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === p2Placeholder ? p.invoice : v]));
}

/** Repot för en nyckel, typat mot sync-bryggans strukturella form (ingen cast). */
function repo(repos: Repositories, key: RepoKey): EntityRepo {
  return repos[key];
}

/** Hård radering (medvetet ADR 0017-undantag) i strukturell form. */
interface HardDeletable { hardDelete(id: string): Promise<void> }
function hardRepo(repos: Repositories, key: RepoKey): HardDeletable {
  return repos[key];
}

/** En skrivning så som synken ser den: entitet, rad, operation och version. */
interface Change { entity: string; rowId: string; op: "create" | "update" | "delete"; version: number }

/** Minnesvägens händelse → samma form. En mjuk borttagning är en update med `deletedAt`. */
function fromEvent(e: MutationEvent<Record<string, unknown>>): Change {
  const op = e.kind === "update" && e.row.deletedAt != null ? "delete" : e.kind;
  return { entity: e.entity, rowId: String(e.row.id), op, version: Number(e.row.version ?? 0) };
}

function fromLog(e: ChangeLogEntry): Change {
  return { entity: e.entity, rowId: e.rowId, op: e.op, version: e.version };
}

async function makeParents(repos: Repositories): Promise<Parents> {
  const id = (): string => uuidv7();
  const p: Parents = {
    org: id(), otherOrg: id(), user: id(), matter: id(), contact: id(),
    invoice: id(), invoice2: id(), plan: id(), document: id(), freeInvoice: id(),
  };
  await repos.users.create({ id: p.user, organizationId: p.org, email: `${p.user}@byra.se`, name: "Förälder", role: "LAWYER" } as never);
  await repos.matters.create({ id: p.matter, organizationId: p.org, matterNumber: "2026-1249", title: "Förälder", status: "ACTIVE" } as never);
  await repos.contacts.create({ id: p.contact, organizationId: p.org, name: "Kontakt", contactType: "PRIVATPERSON" } as never);
  for (const inv of [p.invoice, p.invoice2, p.freeInvoice]) {
    await repos.invoices.create({ id: inv, matterId: p.matter, amount: 100_000, invoiceDate: at, status: "SENT" } as never);
  }
  await repos.paymentPlans.create({ id: p.plan, invoiceId: p.invoice2, monthlyAmount: 1, dayOfMonth: 1, startDate: at, status: "ACTIVE" } as never);
  await repos.documents.create({ id: p.document, matterId: p.matter, fileName: "f.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "x", uploadedById: p.user } as never);
  return p;
}

interface Backend {
  name: string;
  /** Härleder repona byrån via föräldern (ärendet, fakturan, dokumentet)? */
  derivesOrg: boolean;
  /** Öppna backenden; varje skrivning rapporteras till `sink` (MutationEvent resp. change_log). */
  open: (sink: (c: Change) => void) => Promise<{ repos: Repositories; close: () => Promise<void> }>;
}

const BACKENDS: Backend[] = [
  {
    name: "in-memory", derivesOrg: false,
    open: async (sink) => ({ repos: buildInMemoryRepositories(new DemoDataStore({}, (e) => { sink(fromEvent(e)); })), close: async () => {} }),
  },
  {
    name: "Drizzle (pglite)", derivesOrg: true,
    open: async (sink) => {
      const handle: TestDbHandle = await createTestDb();
      const repos = buildDrizzleRepositories(handle.db);
      enableChangeLogOnAll(repos, { record: async (entry) => { sink(fromLog(entry)); } });
      return { repos, close: () => handle.close() };
    },
  },
];

describe("kontraktet täcker varje synkad entitet (genererat ur ENTITY_REGISTRY)", () => {
  it("varje sourceKey med ett repo har en fixtur", () => {
    const sample = buildInMemoryRepositories(new DemoDataStore({}, () => {}));
    const withRepo = Object.values(ENTITY_REGISTRY).map((e) => e.sourceKey).filter((k) => k in sample);
    expect(withRepo.filter((k) => !(k in FIXTURES))).toEqual([]);
  });
});

for (const backend of BACKENDS) {
  describe(`repository-kontraktet — ${backend.name}`, () => {
    let repos: Repositories;
    let parents: Parents;
    let close: () => Promise<void> = async () => {};
    const changes: Change[] = [];
    /** Skrivningarna för en rad sedan `from`. */
    const changesOf = (id: string, from: number): Array<Omit<Change, "rowId">> =>
      changes.slice(from).filter((c) => c.rowId === id).map(({ rowId: _r, ...rest }) => rest);

    beforeAll(async () => {
      ({ repos, close } = await backend.open((c) => { changes.push(c); }));
      parents = await makeParents(repos);
    });
    afterAll(async () => { await close(); });

    for (const [key, fx] of Object.entries(FIXTURES) as Array<[RepoKey, Fixture]>) {
      it(`${key}: skapa → läs → uppdatera (version +1) → mjuk borttagning`, async () => {
        const r = repo(repos, key);
        const id = uuidv7();
        const created = await r.create({ id, ...fx.row(parents) });
        expect(created.id).toBe(id);
        expect((await r.getById(id))?.id).toBe(id);
        // Flera på en gång (#1388): en saknad rad utelämnas.
        expect((await r.getByIds([id, uuidv7()])).map((row) => row.id)).toEqual([id]);

        const patch = resolvePatch(fx.patch, parents);
        const updated = await r.update(id, patch);
        const [field, value] = Object.entries(patch)[0] ?? [];
        expect(updated[field ?? ""]).toEqual(value);
        expect(updated.version).toBe(Number(created.version ?? 1) + 1);

        if (fx.orgColumn) expect(await r.organizationOf(updated)).toBe(parents.org);

        await r.softDelete(id);
        expect(await r.getById(id)).toBeNull();
        expect(await r.getByIds([id])).toEqual([]);
        expect(await r.getByIds([])).toEqual([]);
      });

      // Byrån utan egen kolumn: via ärendet/fakturan/dokumentet (#1242). Organisationen är sin egen rot.
      if (key !== "organizations") {
        it(`${key}: organizationOf ${fx.orgColumn ? "ur radens kolumn" : "via föräldern"}`, async () => {
          const r = repo(repos, key);
          const row = fx.row(parents);
          const created = await r.create({ id: uuidv7(), ...row });
          // Minnesvägen läser bara radens egen kolumn; Drizzle härleder också via föräldern.
          const expected = "organizationId" in row || backend.derivesOrg ? parents.org : undefined;
          expect(await r.organizationOf(created)).toBe(expected);
        });
      }

      it(`${key}: change_log ↔ MutationEvent — samma entitet, operation och version`, async () => {
        const r = repo(repos, key);
        const id = uuidv7();
        const from = changes.length;
        await r.create({ id, ...fx.row(parents) });
        await r.update(id, resolvePatch(fx.patch, parents));
        await r.softDelete(id);
        const entity = ENTITY_NAME_BY_SOURCE_KEY[key];
        // Drizzle loggar bara rader vars byrå går att avgöra (change_log är per byrå).
        if (key === "organizations" && backend.derivesOrg) return;
        expect(changesOf(id, from)).toEqual([
          { entity, op: "create", version: 1 },
          { entity, op: "update", version: 2 },
          { entity, op: "delete", version: 3 },
        ]);
      });

      it(`${key}: hård radering — raden är borta och loggas som delete`, async () => {
        const r = repo(repos, key);
        const id = uuidv7();
        await r.create({ id, ...fx.row(parents) });
        const from = changes.length;
        await hardRepo(repos, key).hardDelete(id);
        expect(await r.getById(id)).toBeNull();
        expect(changesOf(id, from).map((c) => c.op)).toEqual(["delete"]);
      });
    }

    it("byråavgränsning: en rad läses inom sin byrå, aldrig i en annan", async () => {
      const org = asId<"OrganizationId">(parents.org);
      const other = asId<"OrganizationId">(parents.otherOrg);
      const te = uuidv7();
      await repos.timeEntries.create({ id: te, ...FIXTURES.timeEntries.row(parents) } as never);
      expect(await repos.timeEntries.getByIdInOrg(asId<"TimeEntryId">(te), org)).toMatchObject({ id: te });
      expect(await repos.timeEntries.getByIdInOrg(asId<"TimeEntryId">(te), other)).toBeNull();
      expect(await repos.matters.getByIdInOrg(asId<"MatterId">(parents.matter), other)).toBeNull();
      expect(await repos.invoices.getByIdInOrg(asId<"InvoiceId">(parents.invoice), org)).toMatchObject({ id: parents.invoice });
      expect(await repos.invoices.getByIdInOrg(asId<"InvoiceId">(parents.invoice), other)).toBeNull();
    });

    it("frysning: frysta poster lämnar 'ofryst', upplåsning ger tillbaka dem", async () => {
      const matter = asId<"MatterId">(parents.matter);
      const te = asId<"TimeEntryId">(uuidv7());
      const ex = asId<"ExpenseId">(uuidv7());
      await repos.timeEntries.create({ id: te, ...FIXTURES.timeEntries.row(parents) } as never);
      await repos.expenses.create({ id: ex, ...FIXTURES.expenses.row(parents) } as never);
      const run = asId<"BillingRunId">(uuidv7());
      await repos.timeEntries.freezeByIds([te], run, at);
      await repos.expenses.freezeByIds([ex], run, at);
      expect((await repos.timeEntries.listUnfrozenForMatter(matter)).map((t) => t.id)).not.toContain(te);
      expect((await repos.expenses.listUnfrozenForMatter(matter)).map((e) => e.id)).not.toContain(ex);
      await repos.timeEntries.unfreezeByBillingRun(run);
      await repos.expenses.unfreezeByBillingRun(run);
      expect((await repos.timeEntries.listUnfrozenForMatter(matter)).map((t) => t.id)).toContain(te);
      expect((await repos.expenses.listUnfrozenForMatter(matter)).map((e) => e.id)).toContain(ex);
    });
  });
}
