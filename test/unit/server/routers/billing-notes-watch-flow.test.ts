/**
 * Faktureringshändelser → Anteckningar, faktureringsåtgärder → Att bevaka (#1221).
 *
 * Körs genom hela `appRouter` mot en riktig in-memory-store: varje händelse ska
 * lämna en tjänsteanteckning (författare = användaren, datum = händelsen), och
 * varje "måste göras" ska synas som `billingAction` i bevakningslistan tills det
 * är gjort — utan att någon bockar av något.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { RADGIVNING_INVOICE_NOTES } from "@/lib/shared/radgivning-entry";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const M = asId<"MatterId">("m-1");

function makeCaller(matter: Record<string, unknown>, extra: { minutes?: number; otherLawyer?: boolean; noCourt?: boolean; invoices?: Array<Record<string, unknown>>; entry?: Record<string, unknown> } = {}) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: "m-1", organizationId: "org-1", matterNumber: "AA2026-0001", title: "T", status: "ACTIVE",
      responsibleLawyerId: extra.otherLawyer ? "u-2" : "u-1", createdAt: new Date(), ...matter,
    }],
    users: [
      { id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRates: { ARBETE: 250_000 } },
      { id: "u-2", organizationId: "org-1", email: "b@x", name: "Bo", role: "LAWYER" },
    ],
    contacts: [{ id: "c-dom", organizationId: "org-1", name: "Stockholms tingsrätt", contactType: "COMPANY" }],
    // Kontakt-joinen förbakad som i demo-seeden.
    matterContacts: extra.noCourt ? [] : [{ id: "mc-1", matterId: "m-1", contactId: "c-dom", role: "DOMSTOL", contact: { id: "c-dom", name: "Stockholms tingsrätt" } }],
    timeEntries: [{
      id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(),
      minutes: extra.minutes ?? 120, description: "Möte", hourlyRate: 250_000, billable: true, ...extra.entry,
    }],
    expenses: [],
    invoices: extra.invoices ?? [],
  }, async () => { /* skrivbar: noop write-back */ });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
}
type Caller = ReturnType<typeof makeCaller>;

const norm = (s: string): string => s.replace(/\s/g, " ");
async function noteTexts(c: Caller): Promise<string[]> {
  return (await c.serviceNote.list({ matterId: M })).map((n) => norm(n.text));
}
async function actionTitles(c: Caller, mine = false): Promise<string[]> {
  const { items } = await c.watchlist.list({ mine });
  return items.filter((i) => i.kind === "billingAction").map((i) => norm(i.title));
}

describe("faktureringshändelser blir tjänsteanteckningar (#1221)", () => {
  it("rådgivningsfakturan: anteckning på mötesdagen av användaren; 'Skicka faktura' tills den skickats", async () => {
    const c = makeCaller({ paymentMethod: "RATTSHJALP", clientShareBips: 0 });
    const { invoice } = await c.invoice.createRadgivning({ matterId: M, invoiceDate: "2026-03-01T10:00:00Z" });
    const [note] = await c.serviceNote.list({ matterId: M });
    expect(note).toMatchObject({ authorId: "u-1", date: "2026-03-01" });
    expect(norm(note!.text)).toMatch(new RegExp(`^Rådgivningstimme fakturerad klienten — faktura ${invoice.invoiceNumber}, .* kr$`));

    expect(await actionTitles(c)).toEqual([`Skicka faktura ${invoice.invoiceNumber}`]);
    await c.invoiceDispatch.recordManual({ invoiceId: invoice.id, channel: "email", recipient: "klient@x.se" });
    expect(await noteTexts(c)).toContain(`Faktura ${invoice.invoiceNumber} skickad till klient@x.se`);
    expect(await actionTitles(c)).toEqual([]);
  });

  it("köat utskick och manuell statusändring loggas", async () => {
    const c = makeCaller({ paymentMethod: "PRIVAT" });
    const a = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoiceDispatch.queue({ invoiceId: a.invoice.id, channel: "email", recipient: "k@x.se" });
    await c.invoice.setStatus({ invoiceId: a.invoice.id, status: "CANCELLED" });
    const texts = await noteTexts(c);
    expect(texts).toContain(`Faktura ${a.invoice.invoiceNumber} köad för utskick till k@x.se`);
    expect(texts).toContain(`Faktura ${a.invoice.invoiceNumber} markerad som annullerad`);
  });

  it("aconto och slutfaktura: 'Faktura … skapad (typ, belopp)'", async () => {
    const c = makeCaller({ paymentMethod: "PRIVAT" });
    const a = await c.billingRun.createAcconto({ matterId: M, clientShareBips: 2000, amountOre: 100_000, invoiceDate: "2026-02-01" });
    const f = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    const notes = await c.serviceNote.list({ matterId: M });
    expect(notes.find((n) => n.text.includes("aconto"))?.date).toBe("2026-02-01");
    const texts = notes.map((n) => norm(n.text));
    expect(texts).toContain(`Faktura ${a.invoice.invoiceNumber} skapad (aconto, 1 000,00 kr)`);
    expect(texts.some((t) => t.startsWith(`Faktura ${f.invoice.invoiceNumber} skapad (slutfaktura, `))).toBe(true);
  });

  it("kostnadsräkningens livscykel: inskick → beslut → överklagande → hovrätt → faktura; 'Registrera beslut' i Att bevaka", async () => {
    const c = makeCaller({ paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const { run } = await c.billingRun.createKostnadsrakning({ matterId: M });
    expect((await noteTexts(c)).at(-1)).toMatch(new RegExp(`^Kostnadsräkning ${run.reference} till Stockholms tingsrätt skapad — `));
    expect(await actionTitles(c)).toEqual(["Registrera domstolens beslut på kostnadsräkningen"]);

    await c.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: 100_000, prutningOre: -20_000 });
    // Beslutet registrerat → "Skapa faktura" (#1225), samma villkor som KR-kortets knapp.
    expect(await actionTitles(c)).toEqual(["Skapa faktura för kostnadsräkningen (1 000,00 kr)"]);
    await c.billingRun.appealKostnadsrakning({ billingRunId: run.id });
    expect(await actionTitles(c)).toEqual(["Registrera hovrättens beslut på kostnadsräkningen"]);
    await c.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: 110_000 });
    const { items } = await c.watchlist.list({ mine: false });
    expect(items.filter((i) => i.kind === "billingAction")).toEqual([expect.objectContaining({
      title: expect.stringMatching(/^Skapa faktura för kostnadsräkningen \(1\s100,00\skr\)$/),
      detail: "Hovrättens beslut är registrerat.", amountOre: 110_000,
    })]);
    const { invoice } = await c.billingRun.setVerdict({ billingRunId: run.id });

    const texts = await noteTexts(c);
    expect(texts.some((t) => /^Beslut registrerat: dömt belopp 1 000,00 kr \(yrkat .*\), prutning 200,00 kr$/.test(t))).toBe(true);
    expect(texts).toContain(`Beslutet om kostnadsräkning ${run.reference} överklagat till hovrätten`);
    expect(texts.some((t) => t.startsWith("Hovrättens beslut registrerat: dömt belopp 1 100,00 kr"))).toBe(true);
    expect(texts.some((t) => t.startsWith(`Faktura ${invoice.invoiceNumber} skapad (kostnadsräkning till domstol, `))).toBe(true);
    // Domstolsfakturan är skapad men inte skickad → nästa åtgärd.
    expect(await actionTitles(c)).toEqual([`Skicka faktura ${invoice.invoiceNumber}`]);
  });

  it("kreditfaktura: 'Kreditfaktura … skapad (belopp) — krediterar faktura …' av användaren (#1225)", async () => {
    const c = makeCaller({ paymentMethod: "PRIVAT" });
    const a = await c.billingRun.createAcconto({ matterId: M, clientShareBips: 2000, amountOre: 100_000 });
    const credit = await c.invoice.createCredit({ invoiceId: a.invoice.id });
    const notes = await c.serviceNote.list({ matterId: M });
    const note = notes.find((n) => n.text.startsWith("Kreditfaktura"));
    expect(note).toMatchObject({ authorId: "u-1" });
    expect(norm(note!.text)).toBe(`Kreditfaktura ${credit.invoiceNumber} skapad (−1 000,00 kr) — krediterar faktura ${a.invoice.invoiceNumber}`);
  });

  it("slutreglering med kreditfaktura loggas bara som slutreglering (ingen dubbel kreditanteckning)", async () => {
    const c = makeCaller({ paymentMethod: "RATTSHJALP", clientShareBips: 5000, radgivningBetaldAt: null }, { minutes: 60 });
    await c.billingRun.createAcconto({ matterId: M, recipient: "KLIENT", clientShareBips: 5000, amountOre: 5_000_000 });
    const s = await c.billingRun.settleCoverage({ matterId: M, payerRecipient: "DOMSTOL" });
    const texts = await noteTexts(c);
    expect(texts.some((t) => t.startsWith(`Ärendet slutreglerat — kreditfaktura ${s.clientInvoice.invoiceNumber}`))).toBe(true);
    expect(texts.some((t) => t.startsWith("Kreditfaktura"))).toBe(false);
  });

  it("ångrad kostnadsräkning loggas; utan domstolskontakt står 'domstolen'", async () => {
    const c = makeCaller({ paymentMethod: "OFFENTLIGT_UPPDRAG" }, { noCourt: true });
    const { run } = await c.billingRun.createKostnadsrakning({ matterId: M });
    expect((await noteTexts(c))[0]).toMatch(/till domstolen skapad — /);
    await c.billingRun.voidKostnadsrakning({ billingRunId: run.id });
    expect(await noteTexts(c)).toContain(`Kostnadsräkning ${run.reference} ångrad — tidposter och utlägg upplåsta`);
  });

  it("rättsskydd: slutreglering + försäkringens prutning; prutningen väntar i Att bevaka tills den registrerats", async () => {
    const c = makeCaller({ paymentMethod: "RATTSSKYDD", clientShareBips: 2000 });
    const s = await c.billingRun.settleCoverage({ matterId: M, payerRecipient: "FORSAKRING" });
    expect(await actionTitles(c)).toContain("Registrera försäkringsbolagets prutning");
    await c.billingRun.recordInsurerPruning({ matterId: M, prunedNetOre: 10_000 });
    expect(await actionTitles(c)).not.toContain("Registrera försäkringsbolagets prutning");

    const texts = await noteTexts(c);
    expect(texts.some((t) => t.startsWith(`Ärendet slutreglerat — faktura ${s.clientInvoice.invoiceNumber} till klienten (`)
      && t.includes(`faktura ${s.payerInvoice.invoiceNumber} till försäkringsbolag (`))).toBe(true);
    expect(texts).toContain(`Försäkringsbolagets prutning registrerad: 100,00 kr exkl moms flyttat till klientens faktura ${s.clientInvoice.invoiceNumber}`);
  });

  it("betalningssätt och nekat rättsskydd loggas bara när de ändras", async () => {
    const c = makeCaller({ paymentMethod: "PENDING" });
    expect(await actionTitles(c)).toEqual(["Välj betalningssätt"]);
    await c.matter.update({ id: M, paymentMethod: "RATTSSKYDD" });
    await c.matter.update({ id: M, paymentMethod: "RATTSSKYDD", title: "Ny titel" });
    await c.matter.update({ id: M, rattsskyddNekadAt: "2026-02-01" });
    await c.matter.update({ id: M, rattsskyddNekadAt: "2026-02-02" });
    // Samma minut → listans ordning är odefinierad; jämför som mängd.
    expect((await noteTexts(c)).sort()).toEqual(["Betalningssätt: Rättsskydd", "Rättsskydd nekat (2026-02-01)"]);
    expect(await actionTitles(c)).toEqual([]);
  });
});

describe("billingAction i Att bevaka (#1221)", () => {
  it("rådgivningsfaktura utan låst post (före #1205) → 'Markera rådgivningsmötet'; försvinner när mötet markerats", async () => {
    const c = makeCaller({ paymentMethod: "RATTSHJALP", clientShareBips: 0, radgivningBetaldAt: new Date("2025-11-01") }, {
      invoices: [{ id: "inv-r", organizationId: "org-1", matterId: "m-1", invoiceNumber: "F-2025-0001", amount: 100, status: "SENT", invoiceType: "STANDARD", notes: RADGIVNING_INVOICE_NOTES }],
    });
    expect(await actionTitles(c)).toEqual(["Markera rådgivningsmötet som rådgivning"]);
    await c.timeEntry.markAsRadgivning({ id: asId<"TimeEntryId">("te-1") });
    expect(await actionTitles(c)).toEqual([]);
  });

  it("prod-formen (#1235): ej debiterbart möte fryst av KR-körningen — posten försvinner när mötet markerats", async () => {
    const c = makeCaller({ paymentMethod: "RATTSHJALP", clientShareBips: 0, radgivningBetaldAt: new Date("2025-11-01") }, {
      minutes: 60,
      entry: { billable: false, frozenAt: new Date("2026-05-01"), frozenByBillingRunId: "run-kr" },
      invoices: [{ id: "inv-r", organizationId: "org-1", matterId: "m-1", invoiceNumber: "F-2026-0001", amount: 100, status: "DRAFT", invoiceType: "STANDARD", notes: RADGIVNING_INVOICE_NOTES }],
    });
    expect(await actionTitles(c)).toContain("Markera rådgivningsmötet som rådgivning");
    await c.timeEntry.markAsRadgivning({ id: asId<"TimeEntryId">("te-1") });
    expect(await actionTitles(c)).not.toContain("Markera rådgivningsmötet som rådgivning");
  });

  it("självrisken över byråns tröskel → 'Skicka självrisk-aconto'; aconto till klienten tar bort den", async () => {
    // 20 h på normen × 50 % ≫ 1 500 kr.
    const c = makeCaller({ paymentMethod: "RATTSHJALP", clientShareBips: 5000, radgivningBetaldAt: null }, { minutes: 1200 });
    expect((await actionTitles(c)).some((t) => t.startsWith("Skicka självrisk-aconto ("))).toBe(true);
    await c.billingRun.createAcconto({ matterId: M, recipient: "KLIENT", clientShareBips: 5000, amountOre: 1000 });
    expect((await actionTitles(c)).some((t) => t.startsWith("Skicka självrisk-aconto"))).toBe(false);
  });

  it("mine: bara den ansvariga juristens ärenden", async () => {
    const c = makeCaller({ paymentMethod: "PENDING" }, { otherLawyer: true });
    expect(await actionTitles(c, true)).toEqual([]);
    expect(await actionTitles(c, false)).toEqual(["Välj betalningssätt"]);
  });

  it("rättshjälp: beslutad kostnadsräkning → 'Skapa faktura …'; slutregleringen tar bort den (#1225)", async () => {
    const c = makeCaller({ paymentMethod: "RATTSHJALP", clientShareBips: 0, radgivningBetaldAt: null });
    const { run } = await c.billingRun.createKostnadsrakning({ matterId: M });
    await c.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: 50_000 });
    expect(await actionTitles(c)).toEqual(["Skapa faktura för kostnadsräkningen (500,00 kr)"]);
    await c.billingRun.settleCoverage({ matterId: M, payerRecipient: "DOMSTOL" });
    expect((await actionTitles(c)).some((t) => t.startsWith("Skapa faktura för kostnadsräkningen"))).toBe(false);
  });

  it("stängda ärenden väntar inte på något", async () => {
    const c = makeCaller({ paymentMethod: "PENDING", status: "CLOSED" });
    expect(await actionTitles(c)).toEqual([]);
  });

  it("ärendets panel: matterId-filtret ger ärendets faktureringsposter", async () => {
    const c = makeCaller({ paymentMethod: "PENDING" });
    const { items } = await c.watchlist.list({ mine: false, matterId: M });
    expect(items.filter((i) => i.kind === "billingAction")).toEqual([
      expect.objectContaining({ title: "Välj betalningssätt", matterNumber: "AA2026-0001", link: { route: "matters", id: "m-1" } }),
    ]);
  });
});
