/**
 * Faktureringshändelser → Anteckningar (#1221).
 *
 * Körs genom hela `appRouter` mot en riktig in-memory-store: varje händelse ska
 * lämna en tjänsteanteckning (författare = användaren, datum = händelsen).
 * Faktureringsstegen står i ärendets flik Fakturering, inte i Frister (#1735).
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { stockholmDay } from "@/lib/shared/stockholm-time";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const M = asId<"MatterId">("m-1");

function makeCaller(matter: Record<string, unknown>, extra: { minutes?: number; noCourt?: boolean; org?: Record<string, unknown> } = {}) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X", ...extra.org }],
    matters: [{
      id: "m-1", organizationId: "org-1", matterNumber: "AA2026-0001", title: "T", status: "ACTIVE",
      responsibleLawyerId: "u-1", createdAt: new Date(), ...matter,
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
      minutes: extra.minutes ?? 120, description: "Möte", hourlyRate: 250_000, billable: true,
    }],
    expenses: [],
    invoices: [],
  }, async () => { /* skrivbar: noop write-back */ });
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}
type Caller = ReturnType<typeof makeCaller>;

const norm = (s: string): string => s.replace(/\s/g, " ");
async function noteTexts(c: Caller): Promise<string[]> {
  return (await c.serviceNote.list({ matterId: M })).map((n) => norm(n.text));
}
/** Frister (#1735): bara tidsfrister och "Bör faktureras" — aldrig faktureringssteg. */
async function fristerKinds(c: Caller): Promise<string[]> {
  const { items } = await c.watchlist.list({ mine: false });
  return items.map((i) => i.kind).filter((k) => k !== "unbilled");
}

describe("faktureringshändelser blir tjänsteanteckningar (#1221)", () => {
  it("rådgivningsfakturan: anteckning på mötesdagen av användaren; 'Skicka faktura' syns inte i Frister", async () => {
    const c = makeCaller({ paymentMethod: "RATTSHJALP", clientShareBips: 0 });
    const { invoice } = await c.invoice.createRadgivning({ matterId: M, invoiceDate: "2026-03-01T10:00:00Z" });
    const [note] = await c.serviceNote.list({ matterId: M });
    expect(note).toMatchObject({ authorId: "u-1", date: "2026-03-01" });
    expect(norm(note!.text)).toMatch(new RegExp(`^Rådgivningstimme fakturerad klienten — faktura ${invoice.invoiceNumber}, .* kr$`));
    expect(await fristerKinds(c)).toEqual([]);

    await c.invoiceDispatch.recordManual({ invoiceId: invoice.id, channel: "email", recipient: "klient@x.se" });
    expect(await noteTexts(c)).toContain(`Faktura ${invoice.invoiceNumber} skickad till klient@x.se`);
  });

  it("köat utskick och manuell statusändring loggas", async () => {
    const c = makeCaller({ paymentMethod: "PRIVAT" });
    const a = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT" });
    await c.invoiceDispatch.queue({ invoiceId: a.invoice.id, channel: "email", recipient: "k@x.se" });
    // Skickad → krediteras och görs om, annulleras aldrig rakt av (#2260).
    await expect(c.invoice.setStatus({ invoiceId: a.invoice.id, status: "CANCELLED" })).rejects.toThrow(/kreditnota/);
    const credit = await c.invoice.creditAndRedo({ invoiceId: a.invoice.id });
    const texts = await noteTexts(c);
    expect(texts).toContain(`Faktura ${a.invoice.invoiceNumber} köad för utskick till k@x.se`);
    expect(texts.some((t) => t.startsWith(`Kreditfaktura ${credit.invoiceNumber} skapad`) && t.endsWith("posterna är tillbaka under Fakturera"))).toBe(true);
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

  it("aconto och slutfaktura förfaller tio dagar efter fakturadagen när ingen förfallodag anges (2026-11-28)", async () => {
    const c = makeCaller({ paymentMethod: "PRIVAT" });
    const a = await c.billingRun.createAcconto({ matterId: M, clientShareBips: 2000, amountOre: 100_000, invoiceDate: "2026-02-01" });
    expect(stockholmDay(new Date(a.invoice.dueDate ?? ""))).toBe("2026-02-11");
    const f = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT", invoiceDate: "2026-02-20", dueDate: "2026-03-31" });
    expect(new Date(f.invoice.dueDate ?? "").toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("byråns betalningsvillkor 30 dagar ger förfallodagen för aconto, slutfaktura och rådgivning (#2265)", async () => {
    const c = makeCaller({ paymentMethod: "PRIVAT" }, { org: { paymentTermDays: 30 } });
    const a = await c.billingRun.createAcconto({ matterId: M, clientShareBips: 2000, amountOre: 100_000, invoiceDate: "2026-02-01" });
    expect(stockholmDay(new Date(a.invoice.dueDate ?? ""))).toBe("2026-03-03");
    const f = await c.billingRun.createFinal({ matterId: M, recipient: "KLIENT", invoiceDate: "2026-02-20" });
    expect(stockholmDay(new Date(f.invoice.dueDate ?? ""))).toBe("2026-03-22");
    const r = makeCaller({ paymentMethod: "RATTSHJALP", clientShareBips: 0 }, { org: { paymentTermDays: 30 } });
    const { invoice } = await r.invoice.createRadgivning({ matterId: M, invoiceDate: "2026-03-01T10:00:00Z" });
    expect(stockholmDay(new Date(invoice.dueDate ?? ""))).toBe("2026-03-31");
  });

  it("byråns villkor sparat i Inställningar gäller nästa faktura (#2265)", async () => {
    const c = makeCaller({ paymentMethod: "PRIVAT" });
    await c.organization.updateSettings({ paymentTermDays: 0 });
    expect((await c.organization.getSettings()).paymentTermDays).toBe(0);
    const a = await c.billingRun.createAcconto({ matterId: M, clientShareBips: 2000, amountOre: 100_000, invoiceDate: "2026-02-01" });
    expect(stockholmDay(new Date(a.invoice.dueDate ?? ""))).toBe("2026-02-01");
  });

  it("kostnadsräkningens livscykel: inskick → beslut → överklagande → hovrätt → faktura", async () => {
    const c = makeCaller({ paymentMethod: "OFFENTLIGT_UPPDRAG" });
    const { run } = await c.billingRun.createKostnadsrakning({ matterId: M });
    expect((await noteTexts(c)).at(-1)).toMatch(new RegExp(`^Kostnadsräkning ${run.reference} till Stockholms tingsrätt skapad — `));

    await c.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: 100_000, prutningOre: -20_000 });
    await c.billingRun.appealKostnadsrakning({ billingRunId: run.id });
    await c.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: 110_000 });
    const { invoice } = await c.billingRun.setVerdict({ billingRunId: run.id });

    const texts = await noteTexts(c);
    expect(texts.some((t) => /^Beslut registrerat: dömt belopp 1 000,00 kr \(yrkat .*\), prutning 200,00 kr$/.test(t))).toBe(true);
    expect(texts).toContain(`Beslutet om kostnadsräkning ${run.reference} överklagat till hovrätten`);
    expect(texts.some((t) => t.startsWith("Hovrättens beslut registrerat: dömt belopp 1 100,00 kr"))).toBe(true);
    expect(texts.some((t) => t.startsWith(`Faktura ${invoice.invoiceNumber} skapad (kostnadsräkning till domstol, `))).toBe(true);
    // Domstolsfakturan är skapad men inte skickad: steget står i Fakturering, inte i Frister.
    expect(await fristerKinds(c)).toEqual([]);
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

  it("rättsskydd: slutreglering + försäkringens prutning", async () => {
    const c = makeCaller({ paymentMethod: "RATTSSKYDD", clientShareBips: 2000 });
    const s = await c.billingRun.settleCoverage({ matterId: M, payerRecipient: "FORSAKRING" });
    await c.billingRun.recordInsurerPruning({ matterId: M, prunedNetOre: 10_000 });

    const texts = await noteTexts(c);
    expect(texts.some((t) => t.startsWith(`Ärendet slutreglerat — faktura ${s.clientInvoice.invoiceNumber} till klienten (`)
      && t.includes(`faktura ${s.payerInvoice.invoiceNumber} till försäkringsbolag (`))).toBe(true);
    expect(texts).toContain(`Försäkringsbolagets prutning registrerad: 100,00 kr exkl moms flyttat till klientens faktura ${s.clientInvoice.invoiceNumber}`);
  });

  it("betalningssätt och nekat rättsskydd loggas bara när de ändras", async () => {
    const c = makeCaller({ paymentMethod: "PENDING" });
    await c.matter.update({ id: M, paymentMethod: "RATTSSKYDD" });
    await c.matter.update({ id: M, paymentMethod: "RATTSSKYDD", title: "Ny titel" });
    await c.matter.update({ id: M, rattsskyddNekadAt: "2026-02-01" });
    await c.matter.update({ id: M, rattsskyddNekadAt: "2026-02-02" });
    // Samma minut → listans ordning är odefinierad; jämför som mängd.
    expect((await noteTexts(c)).sort()).toEqual(["Betalningssätt: Rättsskydd", "Rättsskydd nekat (2026-02-01)"]);
  });
});
