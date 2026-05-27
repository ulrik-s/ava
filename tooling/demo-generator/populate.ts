/**
 * `populate` — backend-agnostisk demo-data-population via tRPC-API:t.
 *
 * Kör entiteterna i beroende-ordning genom create-mutationerna (med
 * klient-genererade id:n, ADR 0003) → backenden (git/Postgres) persisterar
 * via `IDataStore`. Samma kod oavsett backend.
 *
 * STATUS: första vertikala slice:n (organization → users → contacts).
 * Kvarstående increment (samma mönster): matters (+ matter-contacts via
 * addContact), time-entries, expenses, document-templates, documents,
 * calendar, tasks, conflict-checks — samt BILLING via flöden (createAcconto
 * → recordPayment → createFinal → createPaymentPlan, ADR-beslut 1a) och
 * organization.create för reminders. Se generate.ts-TODO.
 */

import type { SeedDataset } from "../scripts/seed-data";
import type { GeneratorCaller } from "./backend-target";

export interface PopulateResult {
  organizations: number;
  users: number;
  contacts: number;
  matters: number;
  matterContacts: number;
}

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCaller = any;

/** Plocka bort null/undefined → undviker optional-fält-brus mot zod-input. */
function defined(obj: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/** Date|sträng → ISO-sträng (zod-input vill ha sträng för date-fält). */
function isoOrUndef(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return v instanceof Date ? v.toISOString() : String(v);
}

async function createOrganizations(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const o of rows) {
    await c.organization.create(
      defined({ id: o.id, name: o.name, orgNumber: o.orgNumber, address: o.address, phone: o.phone, email: o.email, bankgiro: o.bankgiro }),
    );
  }
}

async function createUsers(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const u of rows) {
    await c.user.create(
      defined({ id: u.id, email: u.email, name: u.name, title: u.title, role: u.role, hourlyRate: u.hourlyRate, mileageRate: u.mileageRate }),
    );
  }
}

async function createContacts(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const ct of rows) {
    await c.contacts.create(
      defined({ id: ct.id, name: ct.name, contactType: ct.contactType, personalNumber: ct.personalNumber, orgNumber: ct.orgNumber, email: ct.email, phone: ct.phone, address: ct.address, notes: ct.notes, parentId: ct.parentId }),
    );
  }
}

async function createMatters(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const m of rows) {
    await c.matter.create(
      defined({ id: m.id, matterNumber: m.matterNumber, title: m.title, description: m.description, matterType: m.matterType, status: m.status, paymentMethod: m.paymentMethod, paymentMethodNote: m.paymentMethodNote, paymentMethodDecidedAt: isoOrUndef(m.paymentMethodDecidedAt), isTaxeArende: m.isTaxeArende, taxaLevel: m.taxaLevel, taxaHuvudforhandlingMin: m.taxaHuvudforhandlingMin, taxaHasFTax: m.taxaHasFTax, createdAt: isoOrUndef(m.createdAt) }),
    );
  }
}

async function createMatterContacts(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const mc of rows) {
    await c.matter.addContact(
      defined({ id: mc.id, matterId: mc.matterId, contactId: mc.contactId, role: mc.role, notes: mc.notes, createdAt: isoOrUndef(mc.createdAt) }),
    );
  }
}

export async function populate(caller: GeneratorCaller, seed: SeedDataset): Promise<PopulateResult> {
  const c = caller as AnyCaller;
  const organizations = seed.organizations ?? [];
  const users = seed.users ?? [];
  const contacts = seed.contacts ?? [];
  const matters = seed.matters ?? [];
  const matterContacts = seed.matterContacts ?? [];

  await createOrganizations(c, organizations); // rot — måste finnas före org-scopat
  await createUsers(c, users); // kräver ADMIN-principal (generatorns principal)
  await createContacts(c, contacts);
  await createMatters(c, matters); // före matter-contacts + allt matterId-refererande
  await createMatterContacts(c, matterContacts);

  return {
    organizations: organizations.length,
    users: users.length,
    contacts: contacts.length,
    matters: matters.length,
    matterContacts: matterContacts.length,
  };
}
