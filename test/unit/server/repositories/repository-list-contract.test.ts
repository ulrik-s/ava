/**
 * Repository-kontraktet utanför CRUD (#1678) — SAMMA scenarier mot minnesrepona
 * (webbläsaren, offline, demon) och Drizzle-repona (Postgres).
 *
 * `repository-contract.test.ts` prövar skapa/läsa/ändra/radera. Skillnaderna
 * som ger tysta fel sitter i listorna: ordningen, mjukt raderade rader och hur
 * söktermen tolkas. Webbappen listar ur minnesrepot, tilläggen och CLI:t ur
 * Postgres — samma byrå ska se samma lista.
 *
 *   - namn sorteras i svensk ordning (Å, Ä, Ö efter Z, versaler och gemener blandat),
 *   - saknade värden sorteras sist, som Postgres (NULLS LAST),
 *   - mjukt raderade rader syns inte i listor, totaler eller dubblettkontroller,
 *   - `%` och `_` i en sökterm eller ett prefix är vanliga tecken,
 *   - sökningen skiljer inte på versaler och gemener, också för Å/Ä/Ö,
 *   - ärendenummerprefixet matchar exakt, med skiftläge,
 *   - kontaktlistans id-filter ger bara de angivna kontakterna; tom lista = inga,
 *   - ärendelistan på ansvarig och i ordningen "senast hänt" (#1967).
 *
 * Kända avvikelser per backend står i en ratchet-lista (`tooling/scripts/ratchet.ts`).
 */

import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { Contact } from "@/lib/shared/schemas/contact";
import type { MatterRole } from "@/lib/shared/schemas/enums";
import { asId, type MatterId, type OrganizationId, type UserId } from "@/lib/shared/schemas/ids";
import type { Matter, MatterContact } from "@/lib/shared/schemas/matter";
import { uuidv7 } from "@/lib/shared/uuid";
import { type KnownDeviation, ratchetDiff } from "../../../../tooling/scripts/ratchet";
import {
  DRIZZLE_HAS_SWEDISH_COLLATION, DRIZZLE_NAME, type OpenRepos, openDrizzleRepos, openInMemoryRepos,
} from "./contract-backends";

type BackendKind = "in-memory" | "drizzle";

interface Backend {
  readonly kind: BackendKind;
  readonly name: string;
  readonly open: () => Promise<OpenRepos>;
  /** Saknar svensk ordning i databasen (pglite, #1917): flaggade scenarier hoppas över. */
  readonly lacksSwedishCollation?: boolean;
}

const BACKENDS: readonly Backend[] = [
  { kind: "in-memory", name: "in-memory", open: () => Promise.resolve(openInMemoryRepos()) },
  { kind: "drizzle", name: DRIZZLE_NAME, open: () => openDrizzleRepos(), lacksSwedishCollation: !DRIZZLE_HAS_SWEDISH_COLLATION },
];

/** Ett scenario svarar med en beskrivning av skillnaden, eller `null` när backenden gör rätt. */
interface Scenario {
  readonly name: string;
  readonly run: (repos: Repositories) => Promise<string | null>;
  /** Kräver svensk ordning i databasen (#1917); körs inte mot en backend utan den. */
  readonly needsSwedishCollation?: boolean;
}

/** Körs scenariot mot backenden? Ett flaggat scenario hoppas över utan svensk ordning, som `itPg`. */
function applies(backend: Backend, scenario: Scenario): boolean {
  return !(scenario.needsSwedishCollation && backend.lacksSwedishCollation);
}

/** Kända avvikelser: `backend: scenario`. */
const KNOWN: Readonly<Record<string, KnownDeviation>> = {
  "in-memory: kontaktpersoner sorteras på namn i svensk ordning": {
    why: "Minnesrepot tillämpar inte `orderBy` i en `include` (read-only-delegate, resolveRelation): kontaktpersonerna kommer i skapad ordning. Drizzle sorterar dem i svensk ordning (#1917). Uppföljning: Intag: ava-feedback#147.",
    issue: 1698,
  },
};

const SWEDISH = new Intl.Collator("sv");
/** Namn där byteordning och svensk ordning skiljer sig (Å/Ä/Ö, versaler och gemener). */
const SWEDISH_NAMES: readonly string[] = ["Örjan", "Åsa", "ärla", "Bertil", "anna", "Adam", "Zelda"];
const swedish = (a: string, b: string): number => SWEDISH.compare(a, b);
/** Mallar som `[kategori, namn]`, i en ordning som varken är svensk eller byteordning; utan kategori sist (#1918). */
const TEMPLATES: readonly (readonly [string | null, string])[] = [
  [null, "Adam"], ["Brev", "Bertil"], ["avtal", "ärla"], ["Ärende", "Örjan"], ["Brev", "anna"], ["Ärende", "Åsa"],
];
const day = (iso: string): Date => new Date(`${iso}T08:00:00.000Z`);
const newOrg = (): OrganizationId => asId<"OrganizationId">(uuidv7());
const newUser = (): UserId => asId<"UserId">(uuidv7());

function differs(actual: unknown, expected: unknown): string | null {
  return isDeepStrictEqual(actual, expected) ? null : `fick ${JSON.stringify(actual)}, väntade ${JSON.stringify(expected)}`;
}

async function addContact(repos: Repositories, org: OrganizationId, over: Partial<Contact>): Promise<Contact> {
  return repos.contacts.create({ id: asId<"ContactId">(uuidv7()), organizationId: org, name: "Kontakt", contactType: "PERSON", ...over });
}

async function addMatter(repos: Repositories, org: OrganizationId, over: Partial<Matter>): Promise<Matter> {
  const matterNumber = over.matterNumber ?? `2026-${uuidv7().slice(-6)}`;
  return repos.matters.create({ id: asId<"MatterId">(uuidv7()), organizationId: org, title: "Ärende", status: "ACTIVE", matterNumber, ...over });
}

async function matterNumbers(repos: Repositories, org: OrganizationId, search?: string): Promise<string[]> {
  return (await repos.matters.listForOrg(org, { search, page: 1, pageSize: 50 })).matters.map((m) => m.matterNumber).sort();
}

async function addParty(repos: Repositories, matter: Matter, contact: Contact, role: MatterRole, createdAt: Date): Promise<MatterContact> {
  return repos.matterContacts.create({ id: asId<"MatterContactId">(uuidv7()), matterId: matter.id, contactId: contact.id, role, createdAt });
}

const numbersOf = (matters: readonly Matter[]): string[] => matters.map((m) => m.matterNumber).sort();

/** En kort paus, så att två skrivningar får olika tider. */
const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 5); });

/** Slagen av poster som räknas i "senast hänt" (#1967). */
type PostKind = "timeEntries" | "expenses" | "documents" | "serviceNotes";
const POST_KINDS: readonly PostKind[] = ["timeEntries", "expenses", "documents", "serviceNotes"];

/** En post av slaget i ärendet; svarar med hur den ändras och raderas. */
async function addPost(repos: Repositories, org: OrganizationId, matterId: MatterId, kind: PostKind): Promise<{ touch: () => Promise<unknown>; remove: () => Promise<unknown> }> {
  const userId = newUser();
  const date = day("2026-01-01");
  switch (kind) {
    case "timeEntries": {
      const row = await repos.timeEntries.create({ id: asId<"TimeEntryId">(uuidv7()), userId, matterId, date, minutes: 30, description: "Samtal", hourlyRate: 150_000 });
      return { touch: () => repos.timeEntries.update(row.id, { minutes: 45 }), remove: () => repos.timeEntries.softDelete(row.id) };
    }
    case "expenses": {
      const row = await repos.expenses.create({ id: asId<"ExpenseId">(uuidv7()), userId, matterId, date, amount: 10_000, description: "Resa", billable: true });
      return { touch: () => repos.expenses.update(row.id, { amount: 12_000 }), remove: () => repos.expenses.softDelete(row.id) };
    }
    case "documents": {
      const row = await repos.documents.create({ id: asId<"DocumentId">(uuidv7()), matterId, fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "documents/content/a", uploadedById: userId });
      return { touch: () => repos.documents.update(row.id, { fileName: "b.pdf" }), remove: () => repos.documents.softDelete(row.id) };
    }
    case "serviceNotes": {
      const row = await repos.serviceNotes.create({ id: asId<"ServiceNoteId">(uuidv7()), organizationId: org, matterId, authorId: userId, date: "2026-01-01", time: "10:00", text: "Samtal" });
      return { touch: () => repos.serviceNotes.update(row.id, { text: "Samtal 2" }), remove: () => repos.serviceNotes.softDelete(row.id) };
    }
  }
}

/** Ärendenumren i ordningen "senast hänt". */
async function byLastActivity(repos: Repositories, org: OrganizationId, page = 1, pageSize = 50): Promise<string[]> {
  return (await repos.matters.listForOrg(org, { orderBy: "lastActivity", page, pageSize })).matters.map((m) => m.matterNumber);
}

/** Ärenden A, B, C skapade i den ordningen, med en paus emellan. */
async function threeMatters(repos: Repositories, org: OrganizationId): Promise<Matter[]> {
  const out: Matter[] = [];
  for (const matterNumber of ["A", "B", "C"]) {
    out.push(await addMatter(repos, org, { matterNumber }));
    await tick();
  }
  return out;
}

/** Kör `run` med en ny byrå per postslag och samla ordningarna per slag. */
async function perKind(run: (org: OrganizationId, kind: PostKind) => Promise<unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const kind of POST_KINDS) out[kind] = await run(newOrg(), kind);
  return out;
}

const forEveryKind = (value: unknown): Record<string, unknown> => Object.fromEntries(POST_KINDS.map((k) => [k, value]));

const SCENARIOS: readonly Scenario[] = [
  {
    name: "kontakter sorteras på namn i svensk ordning",
    needsSwedishCollation: true,
    run: async (repos) => {
      const org = newOrg();
      for (const name of SWEDISH_NAMES) await addContact(repos, org, { name });
      const { contacts } = await repos.contacts.listForOrg(org, { page: 1, pageSize: 50 });
      return differs(contacts.map((c) => c.name), [...SWEDISH_NAMES].sort(swedish));
    },
  },
  {
    name: "kontaktpersoner sorteras på namn i svensk ordning",
    needsSwedishCollation: true,
    run: async (repos) => {
      const org = newOrg();
      const parent = await addContact(repos, org, { name: "Bolaget", contactType: "COMPANY" });
      for (const name of SWEDISH_NAMES) await addContact(repos, org, { name, parentId: parent.id });
      const children = (await repos.contacts.getByIdFull(parent.id, org))?.children ?? [];
      return differs(children.map((c) => c.name), [...SWEDISH_NAMES].sort(swedish));
    },
  },
  {
    // #1918: mappar, mallar, kontor och användare i svensk ordning, som kontakterna.
    name: "mappar, mallar, kontor och användare sorteras på namn i svensk ordning",
    needsSwedishCollation: true,
    run: async (repos) => {
      const org = newOrg();
      const matterId = (await addMatter(repos, org, {})).id;
      const userId = newUser();
      for (const name of SWEDISH_NAMES) {
        await repos.documentFolders.create({ id: asId<"DocumentFolderId">(uuidv7()), matterId, name, parentId: null, createdAt: day("2026-01-01") });
        await repos.offices.create({ id: asId<"OfficeId">(uuidv7()), organizationId: org, name, isMain: name === "Zelda" });
        await repos.users.create({ id: asId<"UserId">(uuidv7()), organizationId: org, email: `${uuidv7()}@byra.se`, name, role: "LAWYER", hourlyRates: {}, active: true });
      }
      for (const [category, name] of TEMPLATES) {
        await repos.documentTemplates.create({ id: asId<"DocumentTemplateId">(uuidv7()), organizationId: org, name, category, content: "", createdById: userId });
      }
      const sorted = [...SWEDISH_NAMES].sort(swedish);
      return differs({
        folders: (await repos.documentFolders.listInParent(matterId, null)).map((f) => f.name),
        byMatter: (await repos.documentFolders.listByMatter(matterId)).map((f) => f.name),
        templates: (await repos.documentTemplates.listForOrg(org)).map((t) => [t.category, t.name]),
        offices: (await repos.offices.listByOrg(org)).map((o) => o.name),
        users: (await repos.users.listByOrg(org)).map((u) => u.name),
      }, {
        folders: sorted, byMatter: sorted,
        templates: [["avtal", "ärla"], ["Brev", "anna"], ["Brev", "Bertil"], ["Ärende", "Åsa"], ["Ärende", "Örjan"], [null, "Adam"]],
        offices: ["Zelda", ...sorted.filter((n) => n !== "Zelda")],
        users: sorted,
      });
    },
  },
  {
    name: "en mjukt raderad kontakt syns inte i listor, totalen eller dubblettkontrollen",
    run: async (repos) => {
      const org = newOrg();
      await addContact(repos, org, { name: "Kvar" });
      const gone = await addContact(repos, org, { name: "Borta", personalNumber: "19800101-1234", orgNumber: "556000-0000" });
      await repos.contacts.softDelete(gone.id);
      const list = await repos.contacts.listForOrg(org, { page: 1, pageSize: 50 });
      return differs({
        list: list.contacts.map((c) => c.name),
        total: list.total,
        all: (await repos.contacts.listAllForOrg(org)).map((c) => c.name),
        byPersonalNumber: await repos.contacts.findByPersonalNumber(org, "19800101-1234"),
        byOrgNumber: await repos.contacts.findByOrgNumber(org, "556000-0000"),
      }, { list: ["Kvar"], total: 1, all: ["Kvar"], byPersonalNumber: null, byOrgNumber: null });
    },
  },
  {
    // #1867: en sida ur en lista som redan är rangordnad i koden, med listradens _count.
    name: "kontaktlistans id-filter: bara de angivna toppnivåkontakterna i byrån, tom lista = inga",
    run: async (repos) => {
      const org = newOrg();
      const alfa = await addContact(repos, org, { name: "Alfa AB", contactType: "COMPANY" });
      const beta = await addContact(repos, org, { name: "Beta" });
      await addContact(repos, org, { name: "Ceta" });
      const child = await addContact(repos, org, { name: "Barn", parentId: alfa.id });
      const gone = await addContact(repos, org, { name: "Borta" });
      await repos.contacts.softDelete(gone.id);
      const foreign = await addContact(repos, newOrg(), { name: "Annan" });
      await addParty(repos, await addMatter(repos, org, {}), alfa, "KLIENT", day("2026-01-01"));
      const page = { page: 1, pageSize: 50 };
      const list = await repos.contacts.listForOrg(org, { ...page, ids: [alfa.id, beta.id, child.id, gone.id, foreign.id] });
      const empty = await repos.contacts.listForOrg(org, { ...page, ids: [] });
      const typed = await repos.contacts.listForOrg(org, { ...page, ids: [alfa.id, beta.id], contactType: "COMPANY" });
      return differs({
        rows: list.contacts.map((c) => ({ name: c.name, _count: c._count })).sort((a, b) => a.name.localeCompare(b.name)),
        total: list.total,
        empty: { names: empty.contacts.map((c) => c.name), total: empty.total },
        typed: typed.contacts.map((c) => c.name),
      }, {
        rows: [{ name: "Alfa AB", _count: { matterLinks: 1, children: 1 } }, { name: "Beta", _count: { matterLinks: 0, children: 0 } }],
        total: 2,
        empty: { names: [], total: 0 },
        typed: ["Alfa AB"],
      });
    },
  },
  {
    name: "ett mjukt raderat ärende syns inte i listan, per ansvarig eller per nummerprefix",
    run: async (repos) => {
      const org = newOrg();
      const lawyer = newUser();
      await addMatter(repos, org, { matterNumber: "AA2026-0001", responsibleLawyerId: lawyer });
      const gone = await addMatter(repos, org, { matterNumber: "AA2026-0002", responsibleLawyerId: lawyer });
      await repos.matters.softDelete(gone.id);
      const list = await repos.matters.listForOrg(org, { page: 1, pageSize: 50 });
      return differs({
        list: numbersOf(list.matters),
        total: list.total,
        byLawyer: numbersOf(await repos.matters.listByResponsibleLawyer(org, lawyer)),
        byPrefix: numbersOf(await repos.matters.listByNumberPrefix(org, "AA2026-")),
      }, { list: ["AA2026-0001"], total: 1, byLawyer: ["AA2026-0001"], byPrefix: ["AA2026-0001"] });
    },
  },
  {
    name: "% och _ i en ärendesökning och ett nummerprefix är vanliga tecken",
    run: async (repos) => {
      const org = newOrg();
      await addMatter(repos, org, { matterNumber: "A_1", title: "Tvist 50% rabatt" });
      await addMatter(repos, org, { matterNumber: "AB1", title: "Tvist 50 kronor" });
      return differs({
        percent: await matterNumbers(repos, org, "50%"),
        underscore: await matterNumbers(repos, org, "A_1"),
        prefix: numbersOf(await repos.matters.listByNumberPrefix(org, "A_")),
      }, { percent: ["A_1"], underscore: ["A_1"], prefix: ["A_1"] });
    },
  },
  {
    name: "ärendenummerprefixet matchar med skiftläge",
    run: async (repos) => {
      const org = newOrg();
      for (const matterNumber of ["AA2026-0001", "aa2026-0002"]) await addMatter(repos, org, { matterNumber });
      return differs(numbersOf(await repos.matters.listByNumberPrefix(org, "AA2026-")), ["AA2026-0001"]);
    },
  },
  {
    name: "listraden bär parterna med klienten först, utan mjukt raderade kopplingar",
    run: async (repos) => {
      const org = newOrg();
      const matter = await addMatter(repos, org, { matterNumber: "P-1" });
      await addMatter(repos, org, { matterNumber: "P-2" });
      const klient = await addContact(repos, org, { name: "Klient AB" });
      await addParty(repos, matter, await addContact(repos, org, { name: "Motpart AB" }), "MOTPART", day("2026-01-01"));
      await addParty(repos, matter, klient, "KLIENT", day("2026-01-02"));
      const gone = await addParty(repos, matter, await addContact(repos, org, { name: "Borta AB" }), "OVRIG", day("2026-01-03"));
      await repos.matterContacts.softDelete(gone.id);
      await addParty(repos, matter, await addContact(repos, org, { name: "Ombud AB" }), "OMBUD", day("2026-01-04"));
      const rows = (await repos.matters.listForOrg(org, { page: 1, pageSize: 50 })).matters;
      const shape = (n: string) => {
        const row = rows.find((m) => m.matterNumber === n);
        return { parties: row?.parties, contacts: row?.contacts };
      };
      return differs({ p1: shape("P-1"), p2: shape("P-2") }, {
        p1: {
          parties: [{ role: "KLIENT", name: "Klient AB" }, { role: "MOTPART", name: "Motpart AB" }, { role: "OMBUD", name: "Ombud AB" }],
          contacts: [{ contact: { id: klient.id, name: "Klient AB" } }],
        },
        p2: { parties: [], contacts: [] },
      });
    },
  },
  {
    name: "ärendelistan filtreras på ansvarig jurist, och totalen följer filtret",
    run: async (repos) => {
      const org = newOrg();
      const lawyer = newUser();
      await addMatter(repos, org, { matterNumber: "R-1", responsibleLawyerId: lawyer });
      await addMatter(repos, org, { matterNumber: "R-2", responsibleLawyerId: newUser() });
      await addMatter(repos, org, { matterNumber: "R-3" });
      const list = await repos.matters.listForOrg(org, { responsibleLawyerId: lawyer, page: 1, pageSize: 50 });
      return differs({ list: numbersOf(list.matters), total: list.total }, { list: ["R-1"], total: 1 });
    },
  },
  {
    name: "senast hänt: utan poster på skapad, och en ny post av varje slag flyttar upp sitt ärende",
    run: async (repos) => differs(await perKind(async (org, kind) => {
      const [a] = await threeMatters(repos, org);
      const before = await byLastActivity(repos, org);
      if (a) await addPost(repos, org, a.id, kind);
      return { before, after: await byLastActivity(repos, org) };
    }), forEveryKind({ before: ["C", "B", "A"], after: ["A", "C", "B"] })),
  },
  {
    name: "senast hänt: en ändrad post flyttar upp sitt ärende",
    run: async (repos) => differs(await perKind(async (org, kind) => {
      const [a, b] = await threeMatters(repos, org);
      if (!a || !b) return null;
      const post = await addPost(repos, org, a.id, kind);
      await tick();
      await addPost(repos, org, b.id, kind);
      const before = await byLastActivity(repos, org);
      await tick();
      await post.touch();
      return { before, after: await byLastActivity(repos, org) };
    }), forEveryKind({ before: ["B", "A", "C"], after: ["A", "B", "C"] })),
  },
  {
    name: "senast hänt: en mjukt raderad post räknas inte",
    run: async (repos) => differs(await perKind(async (org, kind) => {
      const [a] = await threeMatters(repos, org);
      if (!a) return null;
      const post = await addPost(repos, org, a.id, kind);
      await tick();
      await post.remove();
      return byLastActivity(repos, org);
    }), forEveryKind(["C", "B", "A"])),
  },
  {
    name: "senast hänt: sida 2 fortsätter samma ordning med samma total; utan orderBy skapad fallande",
    run: async (repos) => {
      const org = newOrg();
      const [a] = await threeMatters(repos, org);
      if (a) await addPost(repos, org, a.id, "timeEntries");
      const first = await repos.matters.listForOrg(org, { orderBy: "lastActivity", page: 1, pageSize: 2 });
      const second = await repos.matters.listForOrg(org, { orderBy: "lastActivity", page: 2, pageSize: 2 });
      const plain = await repos.matters.listForOrg(org, { page: 1, pageSize: 50 });
      return differs({
        pages: [first.matters.map((m) => m.matterNumber), second.matters.map((m) => m.matterNumber)],
        totals: [first.total, second.total],
        plain: plain.matters.map((m) => m.matterNumber),
        counts: first.matters.map((m) => m._count.timeEntries),
      }, { pages: [["A", "C"], ["B"]], totals: [3, 3], plain: ["C", "B", "A"], counts: [1, 0] });
    },
  },
  {
    name: "uppgifter utan förfallodag sorteras sist, raderade syns inte",
    run: async (repos) => {
      const org = newOrg();
      const user = newUser();
      const add = (title: string, dueAt: Date | null) =>
        repos.tasks.create({ id: asId<"TaskId">(uuidv7()), organizationId: org, userId: user, title, status: "TODO", priority: "MEDIUM", dueAt });
      await add("Senare", day("2026-03-01"));
      await add("Utan", null);
      await add("Först", day("2026-01-01"));
      await repos.tasks.softDelete((await add("Raderad", day("2026-02-01"))).id);
      return differs((await repos.tasks.listForUser(user, org, {})).map((t) => t.title), ["Först", "Senare", "Utan"]);
    },
  },
];

for (const backend of BACKENDS) {
  describe(`repository-kontraktet utanför CRUD — ${backend.name}`, () => {
    let open: OpenRepos;
    beforeAll(async () => { open = await backend.open(); });
    afterAll(async () => { await open.close(); });

    it("listor, sökning och sortering beter sig som i den andra backenden — utom de listade", async () => {
      const found: Record<string, string> = {};
      for (const scenario of SCENARIOS.filter((s) => applies(backend, s))) {
        const mismatch = await scenario.run(open.repos);
        if (mismatch !== null) found[`${backend.kind}: ${scenario.name}`] = mismatch;
      }
      const known = Object.fromEntries(Object.entries(KNOWN).filter(([key]) => key.startsWith(`${backend.kind}: `)));
      const { added, gone } = ratchetDiff(Object.keys(found), Object.keys(known));
      expect({ added: Object.fromEntries(added.map((key) => [key, found[key]])), gone }).toEqual({ added: {}, gone: [] });
    });
  });
}

describe("listan över kända avvikelser", () => {
  it("varje post gäller en backend och ett scenario som finns", () => {
    const keys = BACKENDS.flatMap((b) => SCENARIOS.map((s) => `${b.kind}: ${s.name}`));
    expect(Object.keys(KNOWN).filter((key) => !keys.includes(key))).toEqual([]);
  });
});
