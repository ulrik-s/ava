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
 *   - kontaktlistans id-filter ger bara de angivna kontakterna; tom lista = inga.
 *
 * Kända avvikelser per backend står i en ratchet-lista (`tooling/scripts/ratchet.ts`).
 */

import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { Contact } from "@/lib/shared/schemas/contact";
import type { MatterRole } from "@/lib/shared/schemas/enums";
import { asId, type OrganizationId, type UserId } from "@/lib/shared/schemas/ids";
import type { Matter, MatterContact } from "@/lib/shared/schemas/matter";
import { uuidv7 } from "@/lib/shared/uuid";
import { type KnownDeviation, ratchetDiff } from "../../../../tooling/scripts/ratchet";
import { DRIZZLE_NAME, type OpenRepos, openDrizzleRepos, openInMemoryRepos } from "./contract-backends";

type BackendKind = "in-memory" | "drizzle";

interface Backend {
  readonly kind: BackendKind;
  readonly name: string;
  readonly open: () => Promise<OpenRepos>;
}

const BACKENDS: readonly Backend[] = [
  { kind: "in-memory", name: "in-memory", open: () => Promise.resolve(openInMemoryRepos()) },
  { kind: "drizzle", name: DRIZZLE_NAME, open: () => openDrizzleRepos() },
];

/** Ett scenario svarar med en beskrivning av skillnaden, eller `null` när backenden gör rätt. */
interface Scenario {
  readonly name: string;
  readonly run: (repos: Repositories) => Promise<string | null>;
}

/** Kända avvikelser: `backend: scenario`. */
const KNOWN: Readonly<Record<string, KnownDeviation>> = {
  "drizzle: kontakter sorteras på namn i svensk ordning": {
    why: "Postgres sorterar i databasens kollation: C/byteordning i pglite och Alpine-imagen (Ä före Å, gemener efter Ö). Svensk ordning kräver en ICU-kollation, som pglite saknar.",
    issue: 1698,
  },
};

const SWEDISH = new Intl.Collator("sv");
const swedish = (a: string, b: string): number => SWEDISH.compare(a, b);
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

async function contactNames(repos: Repositories, org: OrganizationId, search?: string): Promise<string[]> {
  return (await repos.contacts.listForOrg(org, { search, page: 1, pageSize: 50 })).contacts.map((c) => c.name).sort(swedish);
}

async function matterNumbers(repos: Repositories, org: OrganizationId, search?: string): Promise<string[]> {
  return (await repos.matters.listForOrg(org, { search, page: 1, pageSize: 50 })).matters.map((m) => m.matterNumber).sort();
}

async function addParty(repos: Repositories, matter: Matter, contact: Contact, role: MatterRole, createdAt: Date): Promise<MatterContact> {
  return repos.matterContacts.create({ id: asId<"MatterContactId">(uuidv7()), matterId: matter.id, contactId: contact.id, role, createdAt });
}

const numbersOf = (matters: readonly Matter[]): string[] => matters.map((m) => m.matterNumber).sort();

const SCENARIOS: readonly Scenario[] = [
  {
    name: "kontakter sorteras på namn i svensk ordning",
    run: async (repos) => {
      const org = newOrg();
      const names = ["Örjan", "Åsa", "ärla", "Bertil", "anna", "Adam", "Zelda"];
      for (const name of names) await addContact(repos, org, { name });
      const { contacts } = await repos.contacts.listForOrg(org, { page: 1, pageSize: 50 });
      return differs(contacts.map((c) => c.name), [...names].sort(swedish));
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
    name: "% och _ i en kontaktsökning är vanliga tecken",
    run: async (repos) => {
      const org = newOrg();
      for (const name of ["Rabatt 100% AB", "100 kronor AB", "a_b Konsult", "axb Konsult", "Back\\slash AB"]) await addContact(repos, org, { name });
      return differs({
        percent: await contactNames(repos, org, "100%"),
        underscore: await contactNames(repos, org, "a_b"),
        backslash: await contactNames(repos, org, "k\\s"),
      }, { percent: ["Rabatt 100% AB"], underscore: ["a_b Konsult"], backslash: ["Back\\slash AB"] });
    },
  },
  {
    name: "kontaktsökningen skiljer inte på versaler och gemener, också Å/Ä/Ö",
    run: async (repos) => {
      const org = newOrg();
      for (const name of ["Åsa Öberg", "Asa Oberg"]) await addContact(repos, org, { name });
      return differs({
        lower: await contactNames(repos, org, "åsa"),
        upper: await contactNames(repos, org, "ÖBERG"),
      }, { lower: ["Åsa Öberg"], upper: ["Åsa Öberg"] });
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
      for (const scenario of SCENARIOS) {
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
