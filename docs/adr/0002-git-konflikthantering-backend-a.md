# ADR 0002 — Git-konflikthantering i Backend A (local-first)

- **Status:** Accepterad
- **Datum:** 2026-05-27
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** Backend A (git/local-first), sync-lagret, sync-UX
- **Bygger på:** [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md)

## Kontext

Acceptansfasens viktigaste mål: **systemet måste fungera — användaren får
aldrig se en git-konflikt hen inte förstår.** Det här gäller bara **Backend A**
(git, local-first); Backend B (Postgres) löser samtidighet med DB-transaktioner
och har inga git-konflikter.

### Hur konflikter faktiskt uppstår idag (grundat i koden)

- Varje entitet är en **egen JSON-fil** (`matters/<id>.json`, `contacts/<id>.json`,
  …). Alla rader har `updatedAt` via `baseFields` i `schemas/common.ts`.
- `useAutoSync` kör `commitLocal → pull → push`.
- `pullBranch` (`fsa/git-ops.ts`) använder `isomorphic-git`s `git.pull()`.
- `SyncLoop` (`local-first/sync-loop.ts`) har en konservativ regel: om lokala
  commits ligger ahead → **skippa tick** (för att aldrig förlora lokala writes).
  Är bara remote ahead → `resetHardToRemote()` (ren fast-forward).

Konsekvensen:

| Scenario | Vad som händer idag |
|---|---|
| Olika entiteter ändrade på båda sidor (olika filer) | Mergas rent (iso-git klarar olika filer) ✅ |
| Bara en sida ändrad | Fast-forward / push ✅ |
| **Samma entitet (samma fil) ändrad på båda sidor** | `isomorphic-git` kan inte 3-way-merga filinnehåll → kastar → bubblar upp som ett **rått felmeddelande** ❌ |

Den gamla `merge-conflict-panel.tsx` är **borttagen**, så `merge-needed`-state:t
har ingen resolutions-UI just nu. `pullBranch` returnerar bara
`up-to-date | fast-forward | merged` och kastar vid äkta konflikt → landar i
`useAutoSync`s generiska `error`-state. **Det är precis den obegripliga
git-konflikten vi vill bort från.**

### Målgrupps-verklighet

Backend A:s kunder är demo, 1-mansbyråer och humanjuridiska byråer. För en
1-mansbyrå finns i praktiken aldrig en äkta samtidig konflikt — värsta fallet är
**samma användare på två enheter** (laptop offline + telefon). Äkta samtidig
redigering av *samma* entitet av *två* personer är sällsynt.

## Beslut (föreslaget)

I Backend A löses konflikter **på entitets-/fil-granularitet, automatiskt, bakom
sync-seamen** — UI:t ser ALDRIG git-merge-tillstånd:

1. **Olika entiteter → merge (oförändrat).** Per-fil-modellen gör att olika
   filer mergas rent. Inget extra behövs.
2. **Samma entitet → last-write-wins (LWW) på `updatedAt`.** *(Bekräftat.)*
   Den nyaste versionen vinner, deterministiskt. Sync blockerar aldrig.
3. **`isomorphic-git`s konflikt-throw fångas och översätts** i sync-lagret —
   visas aldrig rått. Sync-lagret gör entitets-granulär resolution istället för
   att förlita sig på iso-gits hel-träd-merge.
4. **UI:t exponerar bara domän-tillstånd** (`synced`, `pending`, `offline`,
   `konflikt-löst`) — aldrig `MergeNotSupportedError` eller git-interna fel.
5. **Diskret överskrivnings-notis i v1.** *(Bekräftat — inte tyst.)* När LWW
   skriver över en samtidig ändring visar UI:t en diskret notis: *"Din ändring
   av X skrevs över av en nyare version."* Det kräver att sync-lagret
   rapporterar VILKA entiteter som förlorade LWW, så UI:t kan lista dem.
6. **Audit via git-historik.** Den överskrivna versionen finns kvar i
   commit-historiken (inget är permanent borta) → grund för en framtida
   "granska/återställ överskriven ändring"-yta.

LWW + diskret notis är **baslinjen för acceptansfasen**. Två dokumenterade
uppgraderingar (ej nu): **fält-nivå-merge** (slå ihop icke-överlappande fält per
entitet) och en **domän-resolutions-UI** ("du och Anna ändrade samma ärende —
välj din / hennes / behåll båda fält") för flermanna-humanjuridiska byråer som
faktiskt träffar samma-entitet-konflikter.

## Övervägda alternativ

- **Fält-nivå-3-way-merge (nu):** mer robust, men kräver schema-medveten merge +
  mer testyta. Överkurs för acceptansfasen → uppskjutet.
- **Mänsklig resolutions-UI som default:** återinför en konflikt-panel. Men för
  1-mans/humanjuridiskt är konflikten så sällsynt att default-UI är onödig
  friktion → uppskjutet tills en flermannakund träffar det.
- **Pessimistisk låsning ("checka ut" entitet):** dödar offline-stödet och är
  tung drift → förkastad (bryter Backend A:s offline-löfte).

## Konsekvenser

**Positivt**
- Sync fastnar aldrig på något obegripligt → direkt acceptansfas-vinst.
- Enkelt; ingen ny UI krävs; passar 1-mans/humanjuridisk verklighet.
- Inget data permanent förlorat (git-historik = audit).

**Negativt / risker**
- En samtidig redigering av *samma* entitet **skrivs över** (den äldre
  `updatedAt` förlorar i den aktiva vyn). Mildras av (a) den diskreta notisen
  och (b) git-historiken + framtida granskningsyta.
- Kräver att sync-lagret gör entitets-granulär resolution (inte iso-gits
  hel-träd-merge) **och** rapporterar förlorade entiteter till UI:t för notisen
  → en riktig implementations-uppgift (inte gratis).
- LWW kräver pålitlig `updatedAt`. Klock-skew mellan klienter kan ge "fel"
  vinnare → tie-breaka på commit-tid/commit-ordning (se öppen fråga 1).

## Bekräftade beslut

- **Konfliktstrategi:** last-write-wins på `updatedAt` (inte fält-merge i v1).
- **Transparens:** diskret överskrivnings-notis i v1 (inte tyst).

## Öppna frågor (implementationsdetaljer — bekräftas vid bygget)

1. **Klock-skew:** LWW på klientens `updatedAt`, eller på server-/commit-tid?
   *Rekommendation:* `updatedAt` som primär, commit-tid/ordning som tie-break.
2. **Radera-vs-ändra:** om en sida raderar entiteten och en annan ändrar den —
   vinner radering eller ändring? *Rekommendation:* ändring vinner (återupplivar)
   i v1, eftersom oavsiktlig dataförlust är värre; revideras vid behov.
3. **Binärer (PDF/DOCX):** kan inte mergas → LWW på fil-tid. *Rekommendation:* OK.
