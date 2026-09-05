#!/usr/bin/env bun
/**
 * FAKTURAUTSKICK-E2E (#1058) — mot riktig Postgres över riktig HTTP.
 *
 * `invoiceDispatch.*` hade noll e2e. En faktura som inte når mottagaren är tyst
 * kapitalförstöring: ingen betalar, ingen påminns, och inget larmar — till
 * skillnad från en krasch märks det först när likviditeten saknas.
 *
 * ## De två felen som gör mest skada
 *
 * **Dubbelutskick.** `recordManual` registrerar ett utskick som REDAN skett
 * (advokaten mailade själv). Den skapas som `sent`, aldrig `queued` — annars
 * plockar dispatch-workern (#180) upp den och skickar fakturan en gång till,
 * till klienten. Testet kräver därför både att status är `sent` och att posten
 * INTE syns i `listQueued`, för det är kön workern läser.
 *
 * **Faktura som går ut men förblir utkast.** `queue`/`recordManual` flippar
 * DRAFT → SENT (#392). Går den flippen sönder skickas fakturan till klienten
 * medan AVA fortfarande tror att den är ett utkast — och DRAFT ingår inte i
 * `ISSUED_STATUSES`, så den försvinner ur kundfordringsbryggan. Fakturerad
 * intäkt som inte syns i ledningsrapporten, samma familj av fel som #1054.
 *
 * ## Och en invariant åt andra hållet
 *
 * En REDAN utställd faktura får inte röras av ett utskick. Skickar man en
 * påminnelse på en betald faktura ska den förbli `PAID` — `markSentIfDraft`
 * agerar bara på DRAFT. Utan den kontrollen kan en påminnelse "av-betala" en
 * faktura och återuppliva en fordran som är reglerad.
 *
 *   bun run e2e:invoice-dispatch     # startar docker, migrerar, kör, river
 */

import {
  assert, clientFor, kr, seedUser, waitForServer, type Ava,
} from "./e2e-harness";

const USER = "anna-utskick@byra.se";
const RATE_ORE = 250_000;

// ─── Riggning ──────────────────────────────────────────────────────────────

/** Ärende med tid → slutfaktura. Fakturan föds som DRAFT; det är utgångsläget. */
async function draftInvoice(c: Ava, userId: string, key: string, stamp: string): Promise<{ id: string; amount: number }> {
  const client = await c.contacts.create.mutate({
    name: `Utskicksklient ${key} ${stamp}`, contactType: "PERSON",
    email: `utskick-${key}-${stamp}@klient.test`,
  });
  const matter = await c.matter.create.mutate({
    matterNumber: `UTSKICK-${key}-${stamp}`, title: `Utskicksärende ${key} ${stamp}`,
    matterType: "Allmän praktik", paymentMethod: "PRIVAT", responsibleLawyerId: userId,
  });
  await c.matter.addContact.mutate({ matterId: matter.id, contactId: client.id, role: "KLIENT" });
  await c.timeEntry.create.mutate({
    matterId: matter.id, userId, date: "2026-02-10", minutes: 300,
    description: "Handläggning", billable: true, hourlyRate: RATE_ORE,
  });
  const { invoice } = await c.billingRun.createFinal.mutate({
    matterId: matter.id, recipient: "KLIENT", invoiceDate: "2026-02-20", dueDate: "2026-03-20",
  });
  return { id: invoice.id, amount: invoice.amount };
}

async function statusOf(c: Ava, invoiceId: string): Promise<string> {
  return (await c.invoice.getById.query({ id: invoiceId })).status;
}

/** Ligger utskicket i kön workern läser? */
async function isQueued(c: Ava, dispatchId: string): Promise<boolean> {
  const queued = await c.invoiceDispatch.listQueued.query();
  return queued.some((d) => d.id === dispatchId);
}

// ─── Kontroller ────────────────────────────────────────────────────────────

/**
 * Hela livscykeln för ett automatiskt utskick: queued → sent → delivered.
 * Varje övergång ska sätta SIN tidsstämpel — utan dem går det inte att svara
 * på "när skickades fakturan?", vilket är första frågan vid en betalningstvist.
 */
async function verifyQueuedLifecycle(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- Automatiskt utskick: queued → sent → delivered ---");
  const inv = await draftInvoice(c, userId, "auto", stamp);
  assert(await statusOf(c, inv.id) === "DRAFT", "slutfakturan föddes inte som DRAFT");

  const d = await c.invoiceDispatch.queue.mutate({
    invoiceId: inv.id, channel: "email", recipient: `mottagare-${stamp}@klient.test`,
  });
  assert(d.status === "queued", `nytt utskick har status ${d.status}, inte queued`);
  assert(await isQueued(c, d.id), "det köade utskicket syns inte i listQueued — workern hittar det aldrig");
  console.log(`  ✓ Köad för ${kr(inv.amount)} via email, syns i workerns kö`);

  // #392: köad → inte längre utkast. Går den här sönder försvinner fakturan ur
  // kundfordringsbryggan (DRAFT ingår inte i ISSUED_STATUSES).
  assert(await statusOf(c, inv.id) === "SENT", "fakturan är kvar som DRAFT trots köat utskick (#392)");
  console.log("  ✓ Fakturan flippades DRAFT → SENT (annars osynlig i AR-bryggan)");

  const sent = await c.invoiceDispatch.updateStatus.mutate({
    dispatchId: d.id, status: "sent", messageId: `<smtp-${stamp}@ava.test>`,
  });
  assert(sent.status === "sent", `status ${sent.status} ≠ sent`);
  assert(sent.sentAt !== null && sent.sentAt !== undefined, "sentAt sattes inte — går inte att svara på när fakturan gick");
  assert(!(await isQueued(c, d.id)), "utskicket ligger kvar i kön efter sent — workern skickar igen");
  console.log("  ✓ sent: sentAt satt, ute ur kön");

  const delivered = await c.invoiceDispatch.updateStatus.mutate({ dispatchId: d.id, status: "delivered" });
  assert(delivered.deliveredAt !== null && delivered.deliveredAt !== undefined, "deliveredAt sattes inte");
  console.log("  ✓ delivered: deliveredAt satt");

  // Idempotens: workern kan rapportera samma övergång två gånger.
  const again = await c.invoiceDispatch.updateStatus.mutate({ dispatchId: d.id, status: "delivered" });
  assert(again.status === "delivered", "omkörd statusuppdatering ändrade status");
  console.log("  ✓ Omkörning av samma övergång ger samma resultat");
}

/**
 * Manuellt utskick — advokaten mailade själv. Måste födas som `sent`, aldrig
 * `queued`: en post i kön hade fått workern att skicka fakturan EN GÅNG TILL,
 * till klienten. Det är det dyraste felet i den här routern.
 */
async function verifyManualNeverQueued(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- Manuellt utskick: får aldrig hamna i kön ---");
  const inv = await draftInvoice(c, userId, "manuell", stamp);

  const d = await c.invoiceDispatch.recordManual.mutate({
    invoiceId: inv.id, channel: "manual", recipient: `manuell-${stamp}@klient.test`,
  });
  assert(d.status === "sent", `manuellt utskick fick status ${d.status} — queued betyder dubbelutskick`);
  assert(d.sentAt !== null && d.sentAt !== undefined, "sentAt saknas på ett utskick som redan skett");
  assert(!(await isQueued(c, d.id)), "MANUELLT utskick ligger i workerns kö — fakturan skickas två gånger");
  assert(await statusOf(c, inv.id) === "SENT", "manuellt skickad faktura är kvar som DRAFT");
  console.log("  ✓ Skapad som sent, utanför kön, fakturan utställd");
}

/**
 * Ett misslyckat utskick måste bära VARFÖR. Utan felmeddelandet vet ingen om
 * adressen var fel eller om servern var nere — och fakturan ligger obetald
 * medan alla tror att den gått ut.
 */
async function verifyFailureCarriesReason(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- Misslyckat utskick bär orsaken ---");
  const inv = await draftInvoice(c, userId, "trasig", stamp);
  const d = await c.invoiceDispatch.queue.mutate({
    invoiceId: inv.id, channel: "email", recipient: "finns-inte@example.invalid",
  });

  const failed = await c.invoiceDispatch.updateStatus.mutate({
    dispatchId: d.id, status: "failed", error: "550 5.1.1 recipient rejected",
  });
  assert(failed.status === "failed", `status ${failed.status} ≠ failed`);
  assert(failed.failedAt !== null && failed.failedAt !== undefined, "failedAt sattes inte");
  assert((failed.error ?? "").includes("550"), `felmeddelandet tappades: ${String(failed.error)}`);
  assert(!(await isQueued(c, d.id)), "misslyckat utskick ligger kvar i kön och körs om i evighet");
  console.log(`  ✓ failed med orsak bevarad: ${String(failed.error)}`);

  // Historiken per faktura ska visa försöket — annars syns inte att man försökt.
  const list = await c.invoiceDispatch.list.query({ invoiceId: inv.id });
  assert(list.some((x) => x.id === d.id), "det misslyckade försöket saknas i fakturans utskickshistorik");
  console.log("  ✓ Försöket syns i fakturans historik");
}

/**
 * Invarianten åt andra hållet: ett utskick får INTE ändra en redan utställd
 * faktura. En påminnelse på en betald faktura som sätter tillbaka status till
 * SENT återupplivar en reglerad fordran.
 */
async function verifyPaidInvoiceUntouched(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- Påminnelse på betald faktura rör inte statusen ---");
  const inv = await draftInvoice(c, userId, "betald", stamp);
  await c.invoice.setStatus.mutate({ invoiceId: inv.id, status: "SENT" });
  await c.invoice.recordPayment.mutate({
    invoiceId: inv.id, amount: inv.amount, paidAt: "2026-03-01T12:00:00.000Z", note: "Betalt",
  });
  assert(await statusOf(c, inv.id) === "PAID", "fakturan blev inte PAID av full betalning");

  await c.invoiceDispatch.recordManual.mutate({
    invoiceId: inv.id, channel: "email", recipient: `kvitto-${stamp}@klient.test`,
  });
  const after = await statusOf(c, inv.id);
  assert(after === "PAID", `utskicket satte tillbaka fakturan till ${after} — en reglerad fordran återupplivades`);
  console.log("  ✓ Fakturan är kvar som PAID");
}

// ─── Körning ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Anna Utskick");
  const c = clientFor(USER);
  await waitForServer(c);
  const stamp = Date.now().toString(36);
  console.log("Fakturautskick-E2E: kön, dubbelutskicks-skyddet och utkast-flippen");

  await verifyQueuedLifecycle(c, userId, stamp);
  await verifyManualNeverQueued(c, userId, stamp);
  await verifyFailureCarriesReason(c, userId, stamp);
  await verifyPaidInvoiceUntouched(c, userId, stamp);

  console.log("\n✓ Fakturautskick-E2E klart: livscykel, dubbelutskicks-skydd, felorsak och statusinvariant.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Fakturautskick-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
