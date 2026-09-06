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
import { mailDocument } from "@/lib/client/graph/mail-document";
import { asId } from "@/lib/shared/schemas/ids";
import { assert, clientFor, seedUser, waitForServer, type Ava } from "./e2e-harness";
import { assertMessageDelta, snapshotMessageIds, PAGE_SIZE } from "./msgraph-delta";
import { connectGraph, required } from "./msgraph-harness";
import { emitRotatedToken } from "./rotated-token";

const USER = "graf@byra.se";
/** Tak för hur länge vi väntar på att mailet ska landa. Graph är eventuellt
 *  konsistent — en fast `sleep` blir flakig, en obegränsad väntan hänger CI. */
const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 3_000;
/** Tidsposten mailet ska bokföra. Explicit, inte härledd — se `receivedAt`. */
const MAIL_MINUTES = 6;

/**
 * Allt tittande sker i INKORGEN, inte i `/me/messages`.
 *
 * `/me/messages` spänner över hela brevlådan, och `sendMail` sparar en kopia i
 * Skickat. Delta mot hela brevlådan hade därför gett TVÅ nya meddelanden varav
 * vi bara känner id:t på det ena — och frestelsen att härleda det förväntade ur
 * utfallet gör kollen tyst meningslös.
 *
 * `inbox` är ett well-known folder name; adresseras det fel svarar Graph 404,
 * högljutt. `$top` är litet med flit — se PAGE_SIZE.
 */
const INBOX = `${GRAPH_BASE}/me/mailFolders/inbox/messages`;
const MESSAGES_URL = `${INBOX}?$select=id&$top=${PAGE_SIZE}`;

interface GraphMessageHead {
  readonly id: string;
  readonly subject: string;
  readonly receivedDateTime: string;
}

interface GraphAttachment {
  readonly name: string;
  readonly size: number;
}

/** Bilagorna på ett meddelande — det funktion 2 faktiskt lovar. */
async function attachmentsOf(token: string, id: string): Promise<GraphAttachment[]> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/attachments?$select=name,size`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph bilage-listning: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { value?: GraphAttachment[] }).value ?? [];
}

/** Sök upp mailet på ÄMNET. Unikt per körning → aldrig en träff från en tidigare. */
async function findBySubject(token: string, subject: string): Promise<GraphMessageHead | null> {
  const filter = encodeURIComponent(`subject eq '${subject.replace(/'/g, "''")}'`);
  const url = `${INBOX}?$filter=${filter}&$select=id,subject,receivedDateTime`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph sökning misslyckades: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { value?: GraphMessageHead[] };
  return json.value?.[0] ?? null;
}

/**
 * Polla tills `attempt` ger något, med tak. Delad av båda väntorna nedan —
 * de väntar på olika saker men på exakt samma sätt, och taket ska vara ett.
 */
async function poll<T>(what: string, attempt: () => Promise<T | null>, hint: string): Promise<T> {
  for (let i = 1; i <= POLL_ATTEMPTS; i++) {
    const hit = await attempt();
    if (hit !== null) {
      console.log(`• ${what} efter ~${i * (POLL_INTERVAL_MS / 1000)} s`);
      return hit;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`${what}: gav upp efter ${(POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000} s. ${hint}`);
}

/**
 * Hämta rå MIME — men tåla att meddelandet ännu inte finns i storen.
 *
 * Att sökningen hittar ett id betyder INTE att `$value` kan läsa det. Exchange
 * indexerar och materialiserar i olika takt, och `$value` svarar då
 * `404 ErrorItemNotFound`. Verifierat i skarp körning 34056859601: sökningen
 * gav träff efter 3 s, `$value` föll direkt efteråt.
 *
 * Det är därför väntan måste ligga på det vi FAKTISKT behöver — bytes:en —
 * och inte på att en sökning råkat svara. Föregående körning var grön av tur.
 */
async function tryFetchEml(token: string, restId: string): Promise<{ bytes: Uint8Array; base64: string } | null> {
  try {
    return await fetchMessageEml({ token, restId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("HTTP 404")) return null;
    throw e;
  }
}

/**
 * Ingen städning här — och det är ett medvetet val, inte en lucka.
 *
 * `DELETE /me/messages/{id}` kräver `Mail.ReadWrite`, som enligt Microsofts
 * egen tabell är den LÄGSTA behörighet som duger (verifierat mot
 * graph/api/message-delete 2026-09-06; första försöket svarade 403).
 *
 * AVA läser och skickar mail. Att be varje jurist om SKRIVrätt till sin egen
 * brevlåda — för att ett testflöde ska kunna städa efter sig — är precis den
 * sortens över-fråga ADR 0036 argumenterar emot. Consent-dialogen ska gå att
 * läsa och säga ja till.
 *
 * Testmailen ackumuleras därför, ett per nattlig körning. Vad vi gör åt det
 * hör hemma i #1075, som äger både delta-kontroll och städning.
 */

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

  // FÖRE-läget. Delta mot det här är det enda som kan se att körningen
  // producerade något MER än ett mail — read-back kan strukturellt inte det.
  const before = await snapshotMessageIds(fetch, token, MESSAGES_URL);
  console.log(`• Brevlådan före: ${before.size} meddelanden`);

  console.log(`▸ Skickar "${subject}" till ${mailbox} …`);
  await sendMail({ token, message: { subject, body: bodyText, to: [mailbox] } });

  const msg = await poll(
    "Mailet landade", () => findBySubject(token, subject),
    "Kontrollera att AVA_MS_TEST_MAILBOX är brevlådan token:en tillhör.",
  );
  const { bytes, base64 } = await poll(
    "Rå MIME läsbar", () => tryFetchEml(token, msg.id),
    `Meddelandet ${msg.id.slice(0, 20)}… hittades men $value svarade 404 hela vägen.`,
  );
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

  // ── Funktion 2 (#1076): maila ut dokumentet igen, nu som bilaga. ──
  // MSAL:s popup går inte att köra i CI, men Graph-anropen under den gör det.
  // Det är den halvan som kan sluta fungera för att Microsoft ändrat sig.
  //
  // `sendMail`, inte `createDraft`: att skapa ett utkast kräver Mail.ReadWrite,
  // som vi medvetet inte ber om (docs/ms-graph.md).
  const attachSubject = `${subject} bilaga`;
  await mailDocument({
    token,
    doc: { fileName: saved.document.fileName, mimeType: "message/rfc822", bytes },
    to: [mailbox],
    subject: attachSubject,
    body: `Vidarebefordrar ${saved.document.fileName} från ärendet.`,
  });
  const attached = await poll(
    "Bilage-mailet landade", () => findBySubject(token, attachSubject),
    "mailDocument returnerade utan fel men mailet kom aldrig fram.",
  );
  const atts = await attachmentsOf(token, attached.id);
  assert(atts.length === 1, `förväntade en bilaga, fick ${atts.length}`);
  assert(atts[0]!.name === saved.document.fileName, `fel bilagenamn: ${atts[0]!.name}`);
  // Graph rapporterar bilagestorleken inklusive MIME-overhead, så exakt
  // likhet vore fel att kräva — men en bilaga som är MINDRE än innehållet
  // betyder att något trunkerats.
  assert(atts[0]!.size >= bytes.byteLength, `bilagan krympte: ${atts[0]!.size} < ${bytes.byteLength}`);
  console.log(`• Bilaga levererad: ${atts[0]!.name} (${atts[0]!.size} bytes)`);

  // Delta SIST, när allt testet skapar hunnit landa. Det förväntade är EXAKT
  // de två meddelanden vi själva skickade — hårdkodat, inte härlett ur
  // utfallet. Härledde vi det ur `after` hade kollen alltid passerat och tyst
  // slutat betyda något.
  const after = await snapshotMessageIds(fetch, token, MESSAGES_URL);
  assertMessageDelta(before, after, [msg.id, attached.id]);

  console.log("\n✓ Graph mail-E2E grön — skickat, läst som MIME, sparat och verifierat byte för byte.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
