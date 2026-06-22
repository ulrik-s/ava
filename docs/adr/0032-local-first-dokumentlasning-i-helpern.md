# ADR 0032 — Local-first dokument-läsning i helpern

- **Status:** Accepterad (2026-06-22)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** helper-ui (`/open`, `/content`, upload-kön), läs-vägen.
- **Knyter an:** [ADR 0028](0028-autonom-offline-first-helper.md) (helpern = den
  enda lokala dokument-auktoriteten), [ADR 0031](0031-helpern-som-tunn-trpc-klient.md)
  (tRPC-IO + durabel write-back-kö).

## Kontext

`/open` och `/content` är **server-first**: de hämtar alltid serverns version (via
tRPC `downloadContent`) och faller bara tillbaka på den lokala cachen om
nedladdningen *misslyckas* (offline). Men en sparning synkas **asynkront** —
fil-watch upptäcker (~2 s), lägger i den durabla kön, och kön dräneras + laddar
upp (var ~15 s).

I glappet mellan save och uppladdning händer två fel om användaren återöppnar
dokumentet:

1. **Återöppning visar GAMLA versionen.** Servern har ännu inte den sparade
   ändringen → `/open` hämtar den gamla bytsen. Förvirrande ("var tog mina
   ändringar vägen?").
2. **Re-redigering kan tappa den första ändringen.** Öppnar man den gamla
   kopian, redigerar och sparar igen ersätter den nya kö-posten den väntande
   (kön slår ihop per dokument, "senaste vinner") → den första, osynkade
   ändringen skuggas/förloras.

Båda bryter mot ADR 0028:s princip att helpern är den **enda lokala
dokument-auktoriteten**. Auktoriteten är inte helt genomförd på läs-vägen.

## Beslut

**En väntande (osynkad) lokal ändring är auktoritativ tills den synkats.**
Helperns läs-väg blir **local-first** med prioritetsordningen:

1. **Lokal väntande kopia** — finns en kö-post (pending ELLER conflict) för
   dokumentet, servera dess bytes. Det är den färskaste, osynkade versionen.
2. **Server** — hämta via tRPC `downloadContent` (ingen väntande ändring).
3. **Offline-cache** — content-adresserad cache när nedladdning misslyckas.

Gäller både `/open` (öppna i native-app) och `/content` (in-browser-läsning), så
de aldrig divergerar.

## Konsekvenser

- **Återöppning visar alltid din senaste ändring** — även sekunden efter save,
  innan synken hunnit klart.
- **Re-redigering bygger på din ändring** (inte serverns gamla) → ingen
  skuggning/förlust; kö-sammanslagningen blir korrekt (edit-på-edit).
- **Demo opåverkad** — read-only tier, ingen kö → ingen väntande kopia, faller
  rakt till statisk URL.
- **Efter synk** (kö-posten uppladdad + rensad) → `/open` hämtar servern, som nu
  har ändringen. Samma resultat, server-auktoritativ igen.
- **Konflikt-fallet:** en post i `conflict` serveras också lokalt → användaren
  tappar inte sitt arbete; UI:t visar "⚠ Konflikt" och hen kan spara om.

## Genomförande (en PR)

1. `UploadQueue.peekByKey(key)` — läs de köade bytsen för ett dokument (eller
   null).
2. `obtainFile` (`/open`) + `handleContent` (`/content`): kolla väntande lokal
   kopia FÖRST (via en injicerad dep), annars server, annars cache.
3. Wiring i `startEngine` (`queueBackedOnOpen` + `onContent`) → `queue.peekByKey`.
4. Tester (queue-peek + local-first-grenen i open/content).

## Relaterat

ADR 0028 (lokal dokument-auktoritet — den här slutför läs-vägen), 0031 (kön +
tRPC-IO). Föranlett av att återöppning i synk-glappet visade den gamla versionen
och kunde skugga en osynkad ändring.
