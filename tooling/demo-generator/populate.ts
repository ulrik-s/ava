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
  timeEntries: number;
  expenses: number;
  calendarEvents: number;
  tasks: number;
  documentTemplates: number;
  conflictChecks: number;
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

/** Hämta en seed-collection (tål partiella test-seeds → []). */
function pick(seed: SeedDataset, key: keyof SeedDataset): Row[] {
  return ((seed[key] as Row[] | undefined) ?? []);
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

async function createTimeEntries(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const t of rows) {
    await c.timeEntry.create(
      defined({ id: t.id, userId: t.userId, matterId: t.matterId, date: isoOrUndef(t.date), minutes: t.minutes, description: t.description, billable: t.billable, hourlyRate: t.hourlyRate, invoiceId: t.invoiceId, createdAt: isoOrUndef(t.createdAt) }),
    );
  }
}

async function createExpenses(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const e of rows) {
    await c.expense.create(
      defined({ id: e.id, userId: e.userId, matterId: e.matterId, date: isoOrUndef(e.date), amount: e.amount, description: e.description, billable: e.billable, vatRate: e.vatRate, vatIncluded: e.vatIncluded, invoiceId: e.invoiceId, createdAt: isoOrUndef(e.createdAt) }),
    );
  }
}

async function createCalendarEvents(c: AnyCaller, rows: Row[]): Promise<void> {
  // startAt/endAt/createdAt är z.date()-input → skicka Date direkt (in-process caller).
  for (const ev of rows) {
    await c.calendar.create(
      defined({ id: ev.id, userId: ev.userId, kind: ev.kind, title: ev.title, description: ev.description, location: ev.location, startAt: ev.startAt, endAt: ev.endAt, allDay: ev.allDay, matterId: ev.matterId, visibility: ev.visibility, mirrorToOutlook: ev.mirrorToOutlook, createdAt: ev.createdAt }),
    );
  }
}

async function createTasks(c: AnyCaller, rows: Row[]): Promise<void> {
  // dueAt/completedAt/createdAt är z.date()-input → skicka Date direkt.
  for (const t of rows) {
    await c.task.create(
      defined({ id: t.id, userId: t.userId, title: t.title, description: t.description, priority: t.priority, status: t.status, dueAt: t.dueAt, completedAt: t.completedAt, matterId: t.matterId, createdAt: t.createdAt }),
    );
  }
}

async function createDocumentTemplates(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const tpl of rows) {
    await c.documentTemplate.create(
      defined({ id: tpl.id, name: tpl.name, description: tpl.description, category: tpl.category, content: tpl.content, createdById: tpl.createdById, createdAt: isoOrUndef(tpl.createdAt) }),
    );
  }
}

/** Kör konflikt-sökningarna (check-flödet persisterar en konflikt-check-rad). */
async function runConflictChecks(c: AnyCaller, rows: Row[]): Promise<void> {
  for (const cc of rows) {
    await c.conflict.check(defined({ searchTerm: cc.searchTerm, searchType: cc.searchType }));
  }
}

export async function populate(caller: GeneratorCaller, seed: SeedDataset): Promise<PopulateResult> {
  const c = caller as AnyCaller;
  const organizations = pick(seed, "organizations");
  const users = pick(seed, "users");
  const contacts = pick(seed, "contacts");
  const matters = pick(seed, "matters");
  const matterContacts = pick(seed, "matterContacts");
  const timeEntries = pick(seed, "timeEntries");
  const expenses = pick(seed, "expenses");
  const calendarEvents = pick(seed, "calendarEvents");
  const tasks = pick(seed, "tasks");
  const documentTemplates = pick(seed, "documentTemplates");
  const conflictChecks = pick(seed, "conflictChecks");

  await createOrganizations(c, organizations); // rot — måste finnas före org-scopat
  await createUsers(c, users); // kräver ADMIN-principal (generatorns principal)
  await createContacts(c, contacts);
  await createMatters(c, matters); // före matter-contacts + allt matterId-refererande
  await createMatterContacts(c, matterContacts);
  await createTimeEntries(c, timeEntries);
  await createExpenses(c, expenses);
  await createCalendarEvents(c, calendarEvents);
  await createTasks(c, tasks);
  await createDocumentTemplates(c, documentTemplates);
  await runConflictChecks(c, conflictChecks); // efter matter-contacts (söker i dem)

  return {
    organizations: organizations.length,
    users: users.length,
    contacts: contacts.length,
    matters: matters.length,
    matterContacts: matterContacts.length,
    timeEntries: timeEntries.length,
    expenses: expenses.length,
    calendarEvents: calendarEvents.length,
    tasks: tasks.length,
    documentTemplates: documentTemplates.length,
    conflictChecks: conflictChecks.length,
  };
}
