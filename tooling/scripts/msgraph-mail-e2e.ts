#!/usr/bin/env bun
/**
 * Mail-E2E mot riktig Graph (#1074) — kärnan i epicen #1069.
 *
 * `graph-mail.ts` är enhetstestad mot injicerad `fetch`. Den kan därför inte
 * upptäcka att Microsoft ändrat sig, att ett fält heter något annat, eller att
 * `$value` returnerar något annat än vi tror. Det är exakt luckan där Fortnox
 * `·`-buggen bodde: full täckning, grönt, och ändå gick INGEN bokföring igenom.
 *
 * Därför använder det här flödet de RIKTIGA funktionerna ur `graph-mail.ts` —
 * inte egna kopior. Ett e2e som återimplementerar det det ska bevisa bevisar
 * ingenting.
 *
 *   sendMail → polla tills mailet landat → fetchMessageEml ($value)
 *            → mail.saveIncoming mot en riktig AVA-stack
 *            → läs tillbaka och jämför BYTE FÖR BYTE
 *
 * Sista steget är poängen. Att Graph svarade 200 säger inget om att rätt bytes
 * hamnade i rätt ärende.
 *
 * Kör via tooling/scripts/msgraph-mail-e2e.sh (startar stacken) eller i CI.
 */

import { fetchMessageEml, sendMail, GRAPH_BASE } from "@/lib/client/graph/graph-mail";
import { asId } from "@/lib/shared/schemas/ids";
import { assert, clientFor, seedUser, waitForServer, type Ava } from "./e2e-harness";
import { connectGraph, required } from "./msgraph-harness";
import { emitRotatedToken } from "./rotated-token";

const USER = "graf@byra.se";
/** Tak för hur länge vi väntar på att mailet ska landa. Graph är eventuellt
 *  konsistent — en fast `sleep` blir flakig, en obegränsad väntan hänger CI. */
const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 3_000;
/** Tidsposten mailet ska bokföra. Explicit, inte härledd — se `receivedAt`. */
const MAIL_MINUTES = 6;

interface GraphMessageHead {
  readonly id: string;
  readonly subject: string;
  readonly receivedDateTime: string;
}

/** Sök upp mailet på ÄMNET. Unikt per körning → aldrig en träff från en tidigare. */
async function findBySubject(token: string, subject: string): Promise<GraphMessageHead | null> {
  const filter = encodeURIComponent(`subject eq '${subject.replace(/'/g, "''")}'`);
  const url = `${GRAPH_BASE}/me/messages?$filter=${filter}&$select=id,subject,receivedDateTime`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph sökning misslyckades: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { value?: GraphMessageHead[] };
  return json.value?.[0] ?? null;
}

/** Vänta tills mailet dyker upp. Fel efter taket säger VAD som saknades. */
async function waitForMail(token: string, subject: string): Promise<GraphMessageHead> {
  for (let i = 1; i <= POLL_ATTEMPTS; i++) {
    const hit = await findBySubject(token, subject);
    if (hit) {
      console.log(`• Mailet landade efter ~${i * (POLL_INTERVAL_MS / 1000)} s`);
      return hit;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Mailet med ämnet "${subject}" dök aldrig upp inom ` +
    `${(POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000} s. Kontrollera att ` +
    `AVA_MS_TEST_MAILBOX är brevlådan token:en tillhör.`,
  );
}

/** Städa bort testmailet. Graph KAN radera — till skillnad från Fortnox verifikat. */
async function deleteMessage(token: string, id: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  // Städning får aldrig fälla en grön körning — men tystnad är värre än en rad.
  if (!res.ok) console.log(`⚠ Kunde inte radera testmailet (HTTP ${res.status}) — städa manuellt.`);
  else console.log("• Testmailet raderat");
}

async function createMatter(c: Ava, userId: string, matterNumber: string): Promise<string> {
  const m = await c.matter.create.mutate({
    matterNumber,
    title: "Graph mail-E2E",
    matterType: "Allmän praktik",
    paymentMethod: "PRIVAT",
    responsibleLawyerId: userId,
  });
  return m.id;
}

async function main(): Promise<void> {
  const mailbox = required("AVA_MS_TEST_MAILBOX");
  const { store } = await connectGraph();

  // FÖRST av allt: den gamla refresh-token:en är död sedan refreshen ovan.
  await emitRotatedToken(store);
  const tokens = await store.load();
  assert(tokens !== null, "token-store tom efter connectGraph");
  const token = tokens.accessToken;

  const userId = await seedUser(USER, "Graph-testare");
  const c = clientFor(USER);
  await waitForServer(c);

  const stamp = Date.now().toString(36).toUpperCase();
  const matterId = await createMatter(c, userId, `GRAPH-${stamp}`);
  // Unikt ämne per körning — annars kan testet plocka upp ett mail från en
  // tidigare körning och bli grönt på fel bevis.
  const subject = `AVA E2E ${stamp}`;
  const bodyText = `Ärendet GRAPH-${stamp}. Genererat av msgraph-mail-e2e.`;

  console.log(`▸ Skickar "${subject}" till ${mailbox} …`);
  await sendMail({ token, message: { subject, body: bodyText, to: [mailbox] } });

  const msg = await waitForMail(token, subject);

  const { bytes, base64 } = await fetchMessageEml({ token, restId: msg.id });
  assert(bytes.byteLength > 0, "$value gav noll bytes");
  const head = new TextDecoder().decode(bytes.slice(0, 200));
  // Att `$value` ger MIME och inte JSON är en av de saker en mock aldrig kan
  // avslöja. En RFC822-header i början är det billigaste beviset.
  assert(/^[A-Za-z-]+:/.test(head), `$value gav inte MIME — började med: ${head.slice(0, 60)}`);
  console.log(`• Rå MIME hämtad: ${bytes.byteLength} bytes`);

  // `receivedAt` från MAILET, inte väggklockan — körningen ska bete sig likadant
  // oavsett när på dygnet den startar.
  const saved = await c.mail.saveIncoming.mutate({
    matterId: asId<"MatterId">(matterId),
    emlBase64: base64,
    subject,
    receivedAt: msg.receivedDateTime,
    time: { minutes: MAIL_MINUTES, description: `E-post: ${subject}` },
  });
  console.log(`• Sparat på ärendet: ${saved.document.fileName}`);

  // ── Läs TILLBAKA. Att mutationen svarade säger inget om vad som ligger där. ──
  const listed = await c.document.list.query({ matterId: asId<"MatterId">(matterId) });
  const doc = listed.documents.find((d) => d.id === saved.document.id);
  assert(doc !== undefined, "dokumentet finns inte i ärendets dokumentlista");
  assert(doc.mimeType === "message/rfc822", `fel mimeType: ${doc.mimeType}`);
  assert(doc.sizeBytes === bytes.byteLength, `fel storlek: ${doc.sizeBytes} ≠ ${bytes.byteLength}`);

  const back = await c.document.downloadContent.query({ documentId: asId<"DocumentId">(saved.document.id) });
  assert(back.contentBase64 === base64, "innehållet på servern är INTE samma bytes som Graph gav");
  console.log("• Bytes identiska hela vägen: Graph → AVA → tillbaka");

  assert(saved.timeEntry !== null, "ingen tidspost skapades");
  assert(saved.timeEntry.minutes === MAIL_MINUTES, `fel antal minuter: ${saved.timeEntry.minutes}`);
  console.log(`• Tidspost: ${saved.timeEntry.minutes} min`);

  await deleteMessage(token, msg.id);
  console.log("\n✓ Graph mail-E2E grön — skickat, läst som MIME, sparat och verifierat byte för byte.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
