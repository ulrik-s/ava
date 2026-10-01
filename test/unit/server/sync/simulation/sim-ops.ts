/**
 * Stegen i simuleringen (#1268, #1358) och deras vikter.
 *
 * Varje steg är något en användare gör i appen (via routrarna in-process, som
 * i webbläsaren), något nätet gör, eller — sällan — en manipulerad köpost.
 * En lokal regel som säger nej (låst post, saknad behörighet i den cachade
 * rollen, inget att fakturera) är ett giltigt utfall: steget gör då ingenting.
 */
import { QUEUE_FORMAT_VERSION } from "@/lib/shared/sync/queue-format";
import { uuidv7 } from "@/lib/shared/uuid";
import type { Rng } from "../../../helpers/seeded-rng";
import type { SimTab } from "./sim-browser";
import { otherFirm } from "./sync-world";

/** Det ett steg får veta om världen utöver fliken. */
export interface StepContext {
  readonly r: Rng;
  readonly n: number;
  /** Manipulerade köposter (mutationId) — servern måste avvisa dem. */
  readonly forged: Set<string>;
}

type Op = (t: SimTab, ctx: StepContext) => Promise<unknown>;

/** Procedurer bara en administratör får köra (servern avgör med sin roll). */
export const ADMIN_PATHS: ReadonlySet<string> = new Set(["organization.updateSettings", "prefs.setOrgDefault"]);

const DAY = "2026-09-15";
const nothing = (): Promise<void> => Promise.resolve();

const ids = (rows: Array<Record<string, unknown>>): string[] => rows.map((row) => String(row.id));

/** Ett slumpat id bland flikens lokala rader under `key` (som uppfyller `keep`). */
function pickId(t: SimTab, r: Rng, key: string, keep: (row: Record<string, unknown>) => boolean = () => true): string | undefined {
  return r.pick(ids(t.rows(key).filter(keep)));
}

const activeMatter = (row: Record<string, unknown>): boolean => row.status === "ACTIVE";
const byPayment = (method: string) => (row: Record<string, unknown>): boolean => activeMatter(row) && row.paymentMethod === method;

/** Kör `fn` med ett id om det finns ett, annars ingenting. */
function withId(id: string | undefined, fn: (id: string) => Promise<unknown>): Promise<unknown> {
  return id ? fn(id) : nothing();
}

const work: ReadonlyArray<[number, string, Op]> = [
  [6, "tidspost", (t, { r, n }) => withId(pickId(t, r, "matters", activeMatter), (matterId) =>
    t.api.timeEntry.create.mutate({ matterId, date: DAY, minutes: r.int(1, 12) * 15, description: `Post ${t.name}.${n}` }))],
  [4, "ändra tidspost", (t, { r }) => withId(pickId(t, r, "timeEntries"), (id) => t.api.timeEntry.update.mutate({ id, minutes: r.int(1, 12) * 15 }))],
  [2, "ta bort tidspost", (t, { r }) => withId(pickId(t, r, "timeEntries"), (id) => t.api.timeEntry.delete.mutate({ id }))],
  [3, "utlägg", (t, { r, n }) => withId(pickId(t, r, "matters", activeMatter), (matterId) =>
    t.api.expense.create.mutate({ matterId, date: DAY, amount: r.int(1, 50) * 1_000, description: `Utlägg ${t.name}.${n}` }))],
  [2, "ändra utlägg", (t, { r }) => withId(pickId(t, r, "expenses"), (id) => t.api.expense.update.mutate({ id, amount: r.int(1, 50) * 1_000 }))],
  [1, "ta bort utlägg", (t, { r }) => withId(pickId(t, r, "expenses"), (id) => t.api.expense.delete.mutate({ id }))],
];

const parties: ReadonlyArray<[number, string, Op]> = [
  [3, "kontakt", (t, { n }) => t.api.contacts.create.mutate({ name: `Kontakt ${t.name}.${n}`, contactType: "PERSON" })],
  // Delade rader: flera flikar ändrar samma kontakt → inaktuell basversion (lww → rebased).
  [3, "byt namn på kontakt", (t, { r, n }) => withId(pickId(t, r, "contacts"), (id) => t.api.contacts.update.mutate({ id, name: `Omdöpt ${t.name}.${n}` }))],
  [2, "ärende", (t, { r, n }) => t.api.matter.create.mutate({
    title: `Ärende ${t.name}.${n}`, paymentMethod: r.pick(["PRIVAT", "OFFENTLIGT_UPPDRAG"] as const) ?? "PRIVAT",
    ...(r.next() < 0.5 ? { klientId: pickId(t, r, "contacts") } : {}),
  })],
  [1, "ändra ärende", (t, { r, n }) => withId(pickId(t, r, "matters"), (id) => t.api.matter.update.mutate({ id, title: `Nytt namn ${t.name}.${n}` }))],
  [1, "lägg till part", (t, { r }) => withId(pickId(t, r, "matters", activeMatter), (matterId) => withId(pickId(t, r, "contacts"), (contactId) =>
    t.api.matter.addContact.mutate({ matterId, contactId, role: r.pick(["KLIENT", "MOTPART"] as const) ?? "MOTPART" })))],
  [1, "jävskontroll", (t, { r }) => withId(pickId(t, r, "matters"), (id) => t.api.matter.checkConflicts.mutate({ id }))],
];

const billing: ReadonlyArray<[number, string, Op]> = [
  [2, "acontofaktura", (t, { r }) => withId(pickId(t, r, "matters", byPayment("PRIVAT")), (matterId) =>
    t.api.billingRun.createAcconto.mutate({ matterId, clientShareBips: 10000, amountOre: r.int(1, 20) * 10_000 }))],
  [1, "kostnadsräkning", (t, { r }) => withId(pickId(t, r, "matters", byPayment("OFFENTLIGT_UPPDRAG")), (matterId) =>
    t.api.billingRun.createKostnadsrakning.mutate({ matterId }))],
  [1, "ångra kostnadsräkning", (t, { r }) => withId(pickId(t, r, "billingRuns", (b) => b.type === "KOSTNADSRAKNING" && b.status !== "VOIDED"), (billingRunId) =>
    t.api.billingRun.voidKostnadsrakning.mutate({ billingRunId }))],
];

const documents: ReadonlyArray<[number, string, Op]> = [
  [2, "dokument", (t, { r, n }) => withId(pickId(t, r, "matters"), (matterId) => {
    const id = uuidv7();
    return t.api.document.register.mutate({ id, matterId, fileName: `${t.name}-${n}.pdf`, mimeType: "application/pdf", sizeBytes: 1, storagePath: `documents/content/${id}` });
  })],
  [1, "byt titel på dokument", (t, { r, n }) => withId(pickId(t, r, "documents"), (documentId) => t.api.document.updateMetadata.mutate({ documentId, title: `Titel ${n}` }))],
  [1, "ta bort dokument", (t, { r }) => withId(pickId(t, r, "documents"), (id) => t.api.document.delete.mutate({ id }))],
  // En surface-entitet i radkön: samtidiga ändringar ger "stale" — en avvisning som ska synas.
  [2, "pröva händelseförslag", (t, { r }) => withId(pickId(t, r, "matterEventSuggestions"), (eventId) =>
    (r.next() < 0.5 ? t.api.document.rejectEvent.mutate({ eventId }) : t.api.document.markEventAdded.mutate({ eventId })))],
];

/** En köpost som pekar på den andra byråns rader, skriven direkt i webbläsarens kö. */
async function forge(t: SimTab, ctx: StepContext): Promise<void> {
  const target = otherFirm(t.firm);
  const mutationId = uuidv7();
  ctx.forged.add(mutationId);
  const enqueuedAt = Date.now();
  const entry = ctx.r.next() < 0.5
    ? { type: "row" as const, mutationId, entity: "contact", kind: "update" as const, row: { id: target.contact, name: "Kapad" }, baseVersion: 1, enqueuedAt, format: QUEUE_FORMAT_VERSION }
    : { type: "procedure" as const, mutationId, path: "timeEntry.update", input: { id: target.timeEntry, minutes: 15 }, codeVersion: "sim", touches: [], enqueuedAt, format: QUEUE_FORMAT_VERSION };
  await t.browser.queuePersistence().add(entry);
}

const admin: ReadonlyArray<[number, string, Op]> = [
  // Bara administratörer — en degraderad användare med ADMIN cachat köar dem, servern avvisar.
  [2, "byråns bankgiro", (t, { n }) => t.api.organization.updateSettings.mutate({ bankgiro: `${1000 + n}-${t.name.length}` })],
  [2, "byråns standardvy", (t, { n }) => t.api.prefs.setOrgDefault.mutate({ key: "matters-list", prefs: { pageSize: 10 + n } })],
  [1, "manipulerad köpost", forge],
];

const network: ReadonlyArray<[number, string, Op]> = [
  [4, "nät av/på", async (t) => { t.online = !t.online; }],
  [5, "synka", (t) => t.sync()],
  [1, "avbrott mitt i synken", async (t, { r }) => { t.online = true; t.dropAfter = r.int(0, 3); await t.sync(); }],
  [1, "svaret tappas", async (t) => { t.online = true; t.loseNextResponse = true; await t.sync(); }],
  [1, "omstart", (t) => t.boot()],
];

/** Alla steg med vikter. */
export const OPS: ReadonlyArray<[number, string, Op]> = [...work, ...parties, ...billing, ...documents, ...admin, ...network];

/** Välj ett steg med seeden (viktat). */
export function chooseOp(r: Rng): [string, Op] {
  const total = OPS.reduce((sum, [w]) => sum + w, 0);
  let x = r.next() * total;
  for (const [w, name, op] of OPS) {
    if ((x -= w) < 0) return [name, op];
  }
  const [, name, op] = OPS[OPS.length - 1] ?? [0, "synka", (t: SimTab) => t.sync()];
  return [name, op];
}
