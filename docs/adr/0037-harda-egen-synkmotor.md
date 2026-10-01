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
- *Idempotenta* via `mutationId`, också vid samtidiga omkörningar (#1332):
  servern tar ett transaktionslås per `mutationId` och läser det sparade
  utfallet efter låset. I webbläsaren skickar en flik i taget kön
  (Web Locks, `withSyncLock`), så dubbla anrop blir sällsynta.

**Det som bara kan vara preliminärt offline** — för att det kräver en gemensam
sanning — tilldelas i serverns körning: fakturanummer och andra obrutna serier
(#1243, ADR 0012), och jävskontroll (#1246).

**Jävskontrollen (#1246, #1354):** `matter.create` kör kontrollen för klienten
mot byråns alla andra ärenden, och `matter.addContact`/`addNewContact` kör om
den för ärendets alla parter när en klient, motpart eller ett motpartsombud
läggs till (de köas därför som anrop). En träff räknas bara när personen står
på andra sidan i det andra ärendet (`src/lib/shared/conflict-roles.ts`): klient
här och motpart där, eller tvärtom — en återkommande klient är ingen träff.
Resultatet sparas på ärendet
(`conflictCheckStatus`: väntar, inga träffar, träffar att bedöma, bedömd).
Klientens optimistiska körning bär `ctx.provisional`, sätts i `inProcessLink`,
och lämnar kontrollen som väntande: den lokala kopian behöver inte innehålla
hela byrån. Servern kör om anropet och avgör, och dess resultat ersätter det
väntande vid nästa synk. Demon har ingen server och avgör direkt. Ett ärende
som väntar eller har träffar är en bevakning i Att bevaka tills kontrollen
körts om (`matter.checkConflicts`) eller träffarna bedömts
(`matter.markConflictsReviewed`). Bedömningen görs av en advokat eller admin,
kräver en motivering och sparar vem och när (ur anropet, inte klockan) på
ärendet. Båda anropen går via kön.

**Migrering:** entitet för entitet. Radkön finns kvar för ren data (kontakter,
uppgifter, kalender, dokumentens metadata …). Den som har affärsregler går via
procedurkön, och servern tar inte emot färdiga rader för den (#1242).

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
Steg 2c: aconto-, slut-, kredit- och rådgivningsfakturor
(`billingRun.createAcconto/createFinal`, `invoice.createCredit/createRadgivning`).
Fakturanumret tilldelas i serverns körning i fakturadatumets serie; de poster
slutfakturan fryser loggas i change_log (#1319) och följer med i svaret.
Steg 2d: kostnadsräkningsflödet (`billingRun.createKostnadsrakning`,
`voidKostnadsrakning`, `recordKostnadsrakningBeslut`, `appealKostnadsrakning`,
`setVerdict`) och slutregleringen (`settleCoverage`, `recordInsurerPruning`).
KR-referensens serie är anropets år. Därmed körs hela faktureringen om på
servern; radkön bär inte längre några faktureringsrader från UI:t.

**Genomfört (#1242, steg 1–2):** de sista anropen som skrev procedurägda
entiteter köas: fakturautskicken (`invoiceDispatch.queue/recordManual/updateStatus`),
avbetalningspåminnelserna (`paymentPlan.recordReminder/scanDueReminders`) och
`invoice.markFortnoxBooked`. Därefter avvisar servern radpushar för de
procedurägda entiteterna (`procedure-owned.ts`: tid, utlägg, fakturor,
körningar, betalningar, avbetalningsplaner och deras påminnelser, kundförluster,
acontoavdrag, utskick och domstolsfordringar), med ett besked som visas i vyn för
avvisade ändringar. Radvägens egna regler för dem (låsta poster, fakturanummer
ur radpushen) behövs inte längre och är borttagna.

**Genomfört (#1268):** simuleringstester
(`test/unit/server/sync/simulation/`). Flera klienter, byggda som i
webbläsaren, körs mot en server bakom den riktiga tRPC-handlern. Förloppet är
seedat: slumpade ändringar, nätet av och på, avbrott mitt i en synk och
omstarter ur persistensen. Efteråt prövas fyra invarianter:
- ingen ändring försvinner tyst (varje köpost fick ett utfall, och en
  avvisning syns hos klienten);
- klienterna konvergerar mot servern;
- inga dubbla fakturanummer;
- serverläget är detsamma som en seriell körning av de accepterade
  ändringarna i serverns ordning.

På varje PR körs åtta seeds med 60 steg. Varje natt körs 200 seeds med 80 steg
(`.github/workflows/sync-simulation.yml`). Ett fel återskapas med
`AVA_SIM_SEED=<seed>`.

**Genomfört (#1267):** uppföljning på servern. Klienten rapporterar efter
varje synk köns längd och den äldsta osynkade ändringen; admin ser varje enhet
och larmas när en ändring fastnat i en webbläsare mer än ett dygn eller en
enhet inte synkat på en vecka.

**Genomfört (#1242, steg 3):** ärendet är procedurägt. `matter.create` får
klientens id; ärendenumret tilldelas i serverns serie, för året då anropet
gjordes; standardmapparna och klientkopplingen får id härledda ur anropet.
`matter.update` köas i sin helhet — inte bara statusen. Det är en partiell
ändring: bara fälten användaren ändrade skrivs, så två ändringar av olika fält
(titel på en enhet, status på en annan) går inte förlorade, vilket radkönens
hela-raden-LWW inte kunde lova. Skriver ett anrop flera anteckningar får de var
sitt härlett id i skrivordning (`serviceNote`, `serviceNote:2`, …). Ärendets
parter (`matterContact`) och kontakterna är ren data och går via radkön.

**Genomfört (#1345):** omkörningen litar inte på fält som servern annars
bestämmer. Skapa-procedurerna (`timeEntry.create`, `expense.create`,
`matter.create`, `invoice.createRadgivning`) tar emot några *setup-fält* för
demo-generatorn, seed-skripten och E2E-riggarna: någon annans `userId`, ett eget
`hourlyRate`, `invoiceId`, `createdAt`, `matterNumber` och `status`. En gemensam
regel (`src/lib/server/auth/setup-fields.ts`) gäller för dem: i ett köat anrop
avvisas de alltid (FORBIDDEN, även för en administratör — kön bär bara det
användaren gör i UI:t, och UI:t skickar dem aldrig), och i ett direkt anrop får
bara ADMIN sätta dem. Demo-generatorn och seed-skripten kör som ADMIN, och
E2E-riggens fixturanvändare är ADMIN. Det egna id:t som `userId` räknas inte som
setup-fält. Ärendet, juristen och ansvarig jurist slås upp i anroparens byrå
(`org-scope.ts`, NOT_FOUND annars). Migration 0035 lägger en främmande nyckel
från `time_entries.matter_id` och `expenses.matter_id` mot `matters.id`
(ärenden raderas bara mjukt). Den läggs till `NOT VALID`, så att den gäller för
nya rader direkt, och valideras bara om tabellen saknar föräldralösa rader;
annars rapporteras antalet som en NOTICE och raderna lämnas orörda för
utredning — migreringen fäller aldrig en databas med gamla fel.

**Genomfört (#1344):** administrationen är procedurägd. Rollen läses ur
användarraden, och radkön tog emot `user`, `organization`, `office`,
`orgPreference` och `documentTemplate` från alla medlemmar — en färdig rad
`{ id: jag, role: "ADMIN" }` gjorde en medlem till admin. Anropen
(`user.*`, `organization.updateSettings/addOffice/updateOffice/deleteOffice`,
`documentTemplate.*`, `prefs.setOrgDefault/clearOrgDefault`) köas nu och körs
om på servern, där admin-kraven gäller; bankgiro, organisationsnummer och
kontoplan ändras bara av admin, och mallens skapare och skapad-datum är
setup-fält (#1345). Radkön har en policy per entitet
(`row-push-policy.ts`, neka som standard): referenser inom byrån, den
pushande som skapare, ägarens egna preferenser och jävskontrollens logg som
bara kan läggas till (byrån via den som körde kontrollen). En ändring av en
surface-entitet utan basversion avvisas.

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

- Hur visas preliminära fakturanummer i dokument som skapas offline?
- Omprövning: om den egna motorn visar sig dyr att hålla korrekt (simuleringstesterna hittar återkommande fel) utvärderas PowerSync eller Electric på nytt mot samma krav.
