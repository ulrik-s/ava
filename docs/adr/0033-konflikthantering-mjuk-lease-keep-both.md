# ADR 0033 — Konflikthantering: förebygg via mjuk lease, lös via keep-both (ingen merge)

- **Status:** Accepterad (2026-06-22) — *riktning spikad, ännu ej implementerad.*
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** helper-ui (öppning/watch/kö), server-first (dokument-skrivning),
  web-appens dokument-UI, capability-tiers.
- **Knyter an:** [ADR 0028](0028-autonom-offline-first-helper.md) (helpern = lokal
  dokument-auktoritet), [ADR 0031](0031-helpern-som-tunn-trpc-klient.md) (tRPC-IO +
  durabel write-back-kö), [ADR 0032](0032-local-first-dokumentlasning-i-helpern.md)
  (local-first läsning), [ADR 0027](0027-kapabilitets-tierad-klient.md) (tiers).

## Kontext

Användarna (jurister) är **tekniskt omogna**, och dokumenten är binära
Office-filer (.docx/.xlsx) + PDF. Det ger tre hårda randvillkor:

1. **Merge är uteslutet** — inte bara "för tekniskt", utan *omöjligt och
   meningslöst* för en zippad binär .docx. 3-vägs-merge finns inte på bordet.
2. **Tyst överskrivning är värre än en konflikt.** Idag versionskollar
   `document.uploadContent` INTE → sista skrivningen vinner tyst. För juridiska
   dokument är osynlig dataförlust oacceptabelt. Detektering saknas alltså helt.
3. **Juristen är oftast ensam i ärendet** → äkta samtidig redigering är sällsynt.
   Tyngdpunkten ska ligga på att **förebygga** och att **aldrig förlora**, och
   hålla själva lösningen idiotsäker.

### Hur andra gör (referenser)

- **Fil-synk (Dropbox/iCloud/OneDrive):** mergar aldrig binärt — **behåller båda**
  ("konfliktkopia …"). Inget förloras, noll teknik-krav.
- **Realtids-editorer (Google Docs / Office 365 co-authoring):** alla redigerar
  samma levande kopia → konflikter uppstår aldrig. Kräver dokumentet i deras
  webb-editor, inte lokala Word på en temp-fil → passar inte AVA:s helper-modell.
- **Juridiska/enterprise-DMS (iManage, NetDocuments, SharePoint, Worldox):**
  **check-out/check-in (lås)** — standarden i just denna bransch, för att
  förebygga konflikten. AVA tar denna modell men **mjukar** den för offline-first.
- **Dev-verktyg (git):** 3-vägs-merge — uteslutet + irrelevant för binärt.

## Beslut

Fyra lager: **upptäck**, **förebygg**, **krymp fönstret**, **lös sällsynt**.
Ingen merge; ingen läs/skriv-dialog; inget som en icke-teknisk användare måste
förstå för att jobba.

### 1. Upptäck — optimistisk version (stoppar tyst överskrivning)

Helpern skickar med vilken **basversion** den redigerade från; servern avvisar
skrivningen (**409**) om dess version gått förbi. Utan detta finns ingen
"konflikt" att hantera — bara osynlig förlust. Detta är den verkliga luckan att
täppa först. 409 är det som triggar keep-both nedan.

### 2. Förebygg — mjuk lease (osynligt "check-out")

När helpern öppnar ett dokument **för att arbeta** tar den en **lease** på
servern. Andra ser då "**Anna redigerar det här (sedan 14:32)**" och styrs mot
skrivskyddat. Detaljer som gör den ofarlig för omogna användare:

**Interaktionsmodell — ett klick, systemet bestämmer läs/skriv (ingen dialog):**
- **Klick = öppna för att arbeta** → redigerbart + tar lease. Ingen fråga.
- **Dokumentet ledigt** → du redigerar (leasen blir din).
- **Leasat av annan** → öppnas **automatiskt skrivskyddat** ("Anna redigerar …").
  Användaren *valde* aldrig skrivskyddat — systemet skyddade hen.
- **Tekniskt:** redigeringsläge = lease + **watch armas** (sparningar synkas);
  skrivskyddat = **ingen lease, ingen watch** → även oavsiktlig redigering laddas
  aldrig upp. Det gör "skrivskyddat" till en äkta garanti, inte en etikett.
- **Lågmält val:** "Öppna skrivskyddat" i kebab-menyn för medvetet "bara titta".
- **Ventil:** "Öppna ändå för redigering" (med varning) när man *verkligen* måste
  in trots en lease — håller låset mjukt (offline, nödfall). Detta **lånar**
  (leasen ligger kvar), det **låser inte upp**.

**Lease-mekanik — leasen är tidsbegränsad, kan inte fastna permanent:**
- **Heartbeat + TTL:** medan helpern lever förnyar den leasen (~30 s); slutar
  heartbeaten (krasch) **löper leasen ut av sig själv** efter TTL (~3–5 min).
- **Själv-återtagande:** startar samma användares helper om och öppnar igen →
  den ser att leasen är **hennes egen** från en död session och **återtar den
  tyst** (ingen prompt). Täcker det vanligaste krasch-fallet osynligt.
- **Ta över (permanent upplåsning):** en *annan* användare ser, när leasen blivit
  stale (ingen heartbeat på ~2 min), "Anna verkar inte redigera längre" + knapp
  **"Ta över redigeringen"** → servern **omtilldelar** leasen → det döda låset är
  permanent borta. Skiljt från "öppna ändå" (som bara lånar). Gör man inget löper
  leasen ut ändå.
- **Inget manuellt "force-unlock"/admin-ingrepp behövs** — auto-utgång +
  själv-återtagande + ta-över täcker allt. (Admin-"släpp alla lås" vore
  överbyggnad.)

### 3. Krymp fönstret

Synka **vid spara/stäng** (inte bara var 15:e s), och läs **local-first**
(ADR 0032). Då är glappet där en konflikt kan uppstå nästan noll i normalfallet
(online, ensam), och återöppning visar alltid den egna senaste versionen.

### 4. Lös det sällsynta fallet — keep-both (aldrig merge, aldrig förlora)

När en konflikt ändå sker (offline-redigering, utgången/övertagen lease, två
enheter): spara **din** version **separat** (en ny version/kopia — inget skrivs
över) och säg på klarspråk:

> "Det här dokumentet ändrades av någon annan medan du redigerade. **Din version
> har sparats separat — inget är borta.** Öppna båda och kopiera över det du vill
> behålla."

Peka på **Word → Granska → Jämför** (Words inbyggda dokument-jämförelse) för en
visuell diff utan att vi bygger något. **Versionshistoriken** (git-arvet, ert USP)
gör att ingenting någonsin försvinner — man kan alltid backa.

### Offline & tiers

- Leasen bor på servern → den är en **online-koordineringsfunktion**, inte en
  offline-garanti. Offline faller vi tillbaka på local-first + keep-both vid synk.
- **Capability-tiering (ADR 0027):** lås + konflikt gäller bara server-tiers.
  **Demo har ingen server** → ingen lease, inga uppladdningar, inga konflikter.

## Konsekvenser

- **Vanliga fallet = ett klick.** Ensam jurist → lease ledig → öppna och jobba.
- Det enda förebyggande UI man någonsin ser är "Anna redigerar" (igenkännbart från
  Office/SharePoint) — ingen läs/skriv-dialog, inga lägesval, ingen merge.
- **Inget förloras någonsin:** optimistisk version stoppar tyst överskrivning;
  keep-both + versionshistorik bevarar båda sidor.
- **Kraschade lås självläker** (~min) och kan tas över direkt vid behov.
- Kräver server-side: optimistisk versionskontroll på `uploadContent`, en
  lease-store (med heartbeat/TTL/omtilldelning), och dokument-versionering som
  bär två grenar vid keep-both.

## Genomförande (en PR per steg)

1. ✅ **Optimistisk version** på `document.uploadContent` (base-version in → 409 vid
   drift). Helpern bär basversionen från `downloadContent` och **framskriver** den
   från varje lyckad uploads svar (annars self-konflikt vid upprepade saves);
   `baseVersion` persisteras durabelt på kö-posten. Anchor = `version` (metadata-
   skrivningar går via `updateMetadata` som inte bumpar → inga falska 409). En äkta
   konflikt markeras `conflict` i kön + ytläggs i synk-bannern. *(#718)*
2. ✅ **Keep-both vid 409:** användarens version materialiseras som ett **syskon-
   dokument** (`document.saveConflictCopy` → nytt dok i samma ärende/mapp, namn
   `Original (din ändring <label>).ext`, pekar på de uppladdade bytsen). Helpern
   anropar det när kön får 409 och ytlägger `conflictCopy {id,fileName}` på posten.
   Misslyckas materialiseringen (offline) retr:as hela vägen via backoff — bytsen
   är durabelt köade tills kopian kan skapas. Syskonet syns direkt i dokument-
   listan med självförklarande namn; klarspråks-banner + Word-Jämför-länk i steg 5.
   *(#720)*
3. **Lease-store + endpoints** (acquire/renew/release/reclaim/takeover), heartbeat
   + TTL. tRPC-procedurer.
4. **Helper:** ta/förnya/släpp lease vid öppna/stäng; själv-återtagande; öppna
   skrivskyddat (ingen watch) när leasat av annan.
5. **Web-UI:** "X redigerar" + "Ta över redigeringen" + "Öppna skrivskyddat"/
   "Öppna ändå"; konflikt-meddelande + länk till Word Jämför.

## Öppna frågor

- TTL/heartbeat-värden (förslag: heartbeat 30 s, lease-TTL 3–5 min, "stale" efter
  ~2 min) — finjusteras mot verkligt beteende.
- Var leasen lagras (tunn server, ADR 0013/0016) + hur den exponeras tier-agnostiskt.
- ~~Keep-both som ny **dokument-version** vs **syskon-dokument**~~ → **beslutat:
  syskon-dokument** (matchar Dropbox/iCloud-konfliktkopia, kräver ingen versions-
  kedje-schema, mest idiotsäkert). Implementerat i steg 2 (#720).
- Beror på att server-first har dokument-versionering som kan hålla två grenar.

## Relaterat

ADR 0028 (lokal auktoritet), 0031 (kö + tRPC-IO), 0032 (local-first läsning),
0027 (tiers), 0013/0016 (tunn server/server-first). Föranlett av frågan hur
tekniskt omogna jurister ska hantera konflikter utan merge, och hur ett kraschat
lås låses upp permanent (svar: lease med heartbeat/TTL + ta-över).
