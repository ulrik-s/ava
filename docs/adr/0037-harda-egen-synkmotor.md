# ADR 0037 — Härda den egna synkmotorn: procedur-kö med auktoritativ omkörning på servern

**Status:** Antagen · **Datum:** 2026-09-27 · **Issue:** #1248 · **Epic:** #1262
**Reviderar:** [ADR 0017](0017-sync-reconcile-protokoll.md) (kö-formatet) · **Bygger på:** [ADR 0016](0016-server-first-med-offline-first-klient.md), [ADR 0018](0018-offline-auth.md), [ADR 0021](0021-online-only-handlingar.md), [ADR 0012](0012-fakturanummerserier.md)

## Kontext

Designmålet är att en jurist ska kunna arbeta i AVA när servern, nätet eller
inloggningen ligger nere, och att allt synkas rent efteråt (ADR 0016).
Arkitekturgranskningen 2026-09-27 visade att den egna synken (ADR 0017) har en
bra grund — idempotent UUIDv7-kö, per-rad `version`, change_log-cursor per byrå,
konfliktklasser och keep-both för dokument — men att kön lagrar **färdiga rader**
som servern sparar **utan att köra affärsreglerna** (#1242). Pengaregler, låsta
poster och fakturanummer (#1243) blir därmed klientens ansvar.

Vi utvärderade beprövade motorer med tillåtande licens (#1248):

| Alternativ | Varför inte |
|---|---|
| ElectricSQL + TanStack DB (Apache-2.0/MIT) | Löser läsvägen och en offline-kö, men TanStack DB är före 1.0, offline-kön är lite använd och utvecklingen hänger på få personer (i praktiken ElectricSQL:s team). Kräver logisk replikering och en extra tjänst. |
| PowerSync Open Edition | Mogna klienter och företag bakom, men serverdelen har FSL-1.1 (fair source), och egen drift behöver verifieras. |
| Zero (Rocicorp) | Bästa server-auktoritativa modellen (mutators), men stöder uttryckligen inte offline-skrivning. |
| Triplit, Replicache, Dexie Cloud m.fl. | Licens (AGPL, proprietär, kommersiell). |
| CRDT-bibliotek (Automerge, Yjs, Jazz, Evolu, TinyBase) | Servern kan inte upprätthålla belopp, låsning eller nummerserier. |

Ingen motor löser de AVA-specifika delarna (numrering, pengaregler, avvisningar
som juristen förstår, jävskontroll offline). Dessa måste byggas oavsett motor.
Och den viktigaste delen — server-auktoritativ omkörning — kan AVA bygga själv
billigt, eftersom **klient och server redan kör samma `appRouter`**.

## Beslut

**Vi behåller och härdar den egna synkmotorn.** Kärnan ändras från radkö till
**procedur-kö** (samma modell som Replicache/Zero-mutatorer):

1. **Klienten** kör tRPC-proceduren lokalt mot den lokala storen, som idag.
   Allt som går att göra offline fortsätter att fungera offline; affärslogiken
   ligger kvar i den delade koden och körs i klienten.
2. **Kön** lagrar anropet: `{ mutationId, procedur, input, codeVersion }` — inte
   de resulterande raderna.
3. **Servern** kör samma procedur via `appRouter.createCaller(ctx)` i en
   transaktion när kön spelas upp. Resultatet loggas i `change_log` och är det
   som gäller.
4. **Klienten** kastar sitt optimistiska tillstånd för mutationen och tar
   serverns resultat via pull. Samma utfall märks inte; annat utfall (t.ex. en
   kollega hann fakturera samma poster) visas för användaren (#1266).

**Krav på procedurerna** för att få köas:
- *Deterministiska givet input och anropets identitet:* id:n (UUIDv7) och
  tidsstämplar skapas i klienten och skickas med i input, eller härleds ur
  anropet (`newRowId`, `callTime`, #1276); proceduren läser inte egen klocka
  eller slump för affärsvärden.
- *Sidoeffekter bara på servern:* jobb, e-post och externa anrop körs endast i
  serverns körning (ADR 0021 kvarstår).
- *Idempotenta* via `mutationId`.

**Det som bara kan vara preliminärt offline** — för att det kräver en gemensam
sanning — tilldelas i serverns körning: fakturanummer och andra obrutna serier
(#1243, ADR 0012), och jävskontroll (#1246).

**Migrering:** entitet för entitet. Radkön finns kvar för procedurer som ännu
inte flyttats; servern validerar radkön under övergången (#1242).

**Genomfört (#1265):** kärnan (kö-format, `sync.replay`, `sync_replays`,
exklusiv lokal körning med `touches`) och tidsposterna
(`timeEntry.create/update/delete`). Se `docs/architecture.md` → Procedur-kön.

**Genomfört (#1276):** utläggen (`expense.*`) och faktureringens första del:
`invoice.recordPayment/writeOff/setStatus/createPaymentPlan/cancelPaymentPlan`,
`paymentPlan.cancel` och `expectedReceivable.*`. Procedurer som skapar flera
rader behöver inte ta alla id:n i input: anropet har en identitet
(`ctx.queued = { mutationId, at }`) som klientens körning och serverns omkörning
delar. `newRowId(ctx, roll)` härleder radens id ur `mutationId` och rollen
(`derived-id.ts`, ett UUIDv7 med anropets tidsstämpel), och `callTime(ctx)` ger
när anropet gjordes. Affärsdatum som saknas i input (avskrivningsdag,
anteckningens datum) blir därmed samma i båda körningarna. Svaret läser alla
berörda rader via entitetens repo, avgränsat till byrån (`entity-repo.ts`).

## Konsekvenser

- Affärsreglerna upprätthålls på servern utan att dubbelskrivas — samma kod körs
  på båda ställen.
- Inga nya beroenden, ingen extra tjänst, ingen logisk replikering, ingen
  licensfråga.
- Vi äger motorns korrekthet. Det kräver simuleringstester (#1268), uppföljning
  på servern (#1267) och migrering av lokala data (#1269) — arbete som hade
  behövts även med en extern motor för de AVA-specifika delarna.
- Procedurer som läser klockan eller skapar id:n internt måste göras om.

## Genomförande (issues)

| Ordning | Issue | Vad |
|---|---|---|
| 1 | #1240, #1241 | App-skal i service workern och beständig lagring |
| 2 | #1265 | Procedur-kö och auktoritativ omkörning |
| 3 | #1243 | Fakturanummer från servern, unikt index |
| 4 | #1266, #1267, #1268 | Konfliktvy, uppföljning, simuleringstester |
| 5 | #1247, #1269 | Versionerad kö och migrering av lokala data |
| — | #1234, #1244, #1245, #1246 | Borttagning, arbetsmängd, offline-inloggning, jävskontroll |

## Öppna frågor

- Hur länge ska radkön finnas kvar under migreringen, och vilka procedurer flyttas först (förslag: tidsposter, därefter fakturering)?
- Hur visas preliminära fakturanummer i dokument som skapas offline?
- Omprövning: om den egna motorn visar sig dyr att hålla korrekt (simuleringstesterna hittar återkommande fel) utvärderas PowerSync eller Electric på nytt mot samma krav.
