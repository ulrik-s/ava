# ADR 0004 — `schemaVersion` i repot + versionsgrind vid hydrering

- **Status:** Accepterad
- **Datum:** 2026-06-07
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** `.ava/meta.json`, klon-/hydreringsvägen (`clone-from-github`,
  demo-bootstrap), `src/lib/shared/schemas/`, event-loggen, datamodell-evolution
- **Issue:** [#8](https://github.com/ulrik-s/ava/issues/8)

## Kontext

I Git-backenden (Backend A, [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md))
lever **all data i användarens git-repo** — inte i en server-DB vi kontrollerar.
Det betyder att en godtycklig kombination av *kod-version* och *data-version*
kan mötas: en användare öppnar appen mot ett repo som skrevs av en äldre (eller
nyare) AVA-build.

Idag finns **ingen koppling** mellan de två:

- Alla nio domänscheman i `src/lib/shared/schemas/` kör `.passthrough()`. Det ger
  *oavsiktlig* framåtkompatibilitet (okända fält överlever en round-trip), men
  bara för **additiva** ändringar. En **brytande** ändring — fält som byter typ,
  blir obligatoriskt, eller byter namn — får en strict-parse att antingen krascha
  vid läsning eller, värre, **tyst släppa raden** på hydrering (samma failure-mode
  som dokumenterad i `local-first/projections`: scheman som inte matchar
  mutation-output → tomma listor).
- Den append-only event-loggen (`src/lib/server/events/schema.ts`) gör problemet
  permanent: gamla payloads ligger kvar i sitt ursprungsformat för evigt. "Fixa
  framåt i nästa write" räcker inte — historik måste gå att läsa.

Detta är den största strukturella luckan inför produktion: en envägsdörr mot
oläsbar eller korrupt data hos en riktig byrå. Vi behöver (a) veta vilken
schema-version ett repo har och (b) vägra göra skada när kod och data inte matchar.

`manifest.json` har redan ett `version`-fält, men det är **manifest-format**-versionen
(GH Pages fil-listning, demo-specifik) — inte datamodellen. Det får inte överlastas.

## Beslut

### 1. En monoton heltals-`schemaVersion` per repo, i `.ava/meta.json`

Datamodellen versioneras med **ett enda monotont heltal** för hela repot, inte
per-entitet och inte semver. Ett repo migreras som en enhet; en kod-build hör
ihop med exakt en `schemaVersion`.

Versionen lagras i `.ava/meta.json` (`DemoMeta`/repo-meta), som **redan läses vid
bootstrap i båda tiers** (demo hämtar `organizationId` därifrån; self-hosted
failar tydligt om filen saknas). Det är därför det naturliga, redan-hydrerade
hemmet — inget nytt filformat, ingen ny läsväg.

```jsonc
// .ava/meta.json
{
  "schemaVersion": 1,        // NYTT — datamodellens version
  "organizationId": "…",
  "organizationName": "…",
  "users": [ … ],
  "buildAt": "…"
}
```

Koden exporterar en konstant `CURRENT_SCHEMA_VERSION` (single source of truth,
bredvid schemana i `src/lib/shared/`). Dagens form fryses som **version 1**.

### 2. Versionsgrind vid klon/hydrering — *innan* domänen ser någon rad

I klon-/bootstrap-vägen (`clone-from-github` → hydrering), jämför repots
`schemaVersion` mot `CURRENT_SCHEMA_VERSION`:

| Fall | Beteende |
|---|---|
| `repo == kod` | Fortsätt normalt. |
| `repo < kod` | **Migrera-on-read** (se §3). Tills migreringskedjor finns: detta fall kan inte uppstå eftersom v1 är baslinjen. |
| `repo > kod` | **VÄGRA starta** med ett tydligt, åtgärdbart fel ("Det här repot skrevs av en nyare AVA-version — uppdatera appen innan du öppnar det"). En gammal build får **aldrig** skriva till ett nyare repo. |
| `schemaVersion saknas` | Tolka som **v1** (baslinje). Repon som skapades före detta ADR har ingen version men har v1-formen; första write stämplar `schemaVersion: 1`. |

Den kritiska säkerhetsegenskapen är **`repo > kod` → vägra**. Det är det enda som
skyddar mot tyst datakorruption (en gammal build som passthrough-droppar fält den
inte känner till och skriver tillbaka en stympad rad).

### 3. Migrate-on-read som riktning (egen uppföljnings-PR)

När en brytande schemaändring landar:

1. Bumpa `CURRENT_SCHEMA_VERSION` (N → N+1).
2. Lägg en ren `migrate_N_to_N+1(row)`-funktion som lyfter en gammal rad till den
   nya formen **innan domänen/zod-parsern ser den**. Kedjas (`v1→v2→v3`) så ett
   gammalt repo kan hoppa flera steg.
3. Vid första write i den nya versionen skrivs `schemaVersion: N+1` till
   `.ava/meta.json`.

Migrate-on-read (inte migrate-on-clone) väljs för att det fungerar även för den
append-only event-loggen, där historiska payloads aldrig skrivs om.

### 4. Bump-policy — när krävs en versionshöjning?

- **Additiv ändring** (nytt *optionellt* fält): ingen bump. `.passthrough()` +
  optional zod-fält bär det. Detta är den vanliga ändringen.
- **Brytande ändring** (rename, typbyte, fält blir obligatoriskt, semantikbyte):
  **bump krävs** + en migrering. Detta är regeln som CODEOWNERS-review av
  `src/lib/shared/schemas/` ska upprätthålla.

## Konsekvenser

**Positivt**
- Säkerhetsnät mot oläsbar/korrupt användardata — den största produktionsrisken
  i Backend A stängs.
- Steg 1 (versionsfält + grind, ingen migrering) kan landa fristående och låser
  v1 som baslinje *innan* första brytande ändring tvingar fram en migrering.
- Ingen ny fil-/läsväg: `.ava/meta.json` hydreras redan i båda tiers.
- Backend B (Postgres) påverkas inte — där sköter DB-migreringar samma sak;
  `schemaVersion` är en Backend-A-artefakt.

**Negativt / risker**
- Disciplinkrav: varje brytande schemaändring *måste* paras med en bump +
  migrering. Glöms det → samma tysta-drop-bugg vi försöker eliminera. Måste
  fångas i CODEOWNERS-review (och på sikt ett test/lint som jämför schema-hash
  mot version).
- Migrate-on-read kostar lite vid varje läsning tills ett repo skrivits om i ny
  version. Försumbart för datavolymerna i Backend A.
- Event-payload-versionering är en egen, senare PR — tills den finns är
  loggen oförändrad och historiska payloads orörda (men nu medvetet uppskjutet,
  inte förbisett).

## Fasning

1. **PR 1 (nu):** `schemaVersion` i `.ava/meta.json` + `CURRENT_SCHEMA_VERSION`-
   konstant + grinden (alla fyra fall). Ingen migreringskedja än. Test:
   `repo > kod` vägrar; saknad version tolkas som v1.
2. **PR 2:** migrate-on-read-ramverket + första riktiga migrationen som proof
   (issuets "klar när": versionsgrind + minst en testad migrationskedja).
3. **PR 3:** versionera event-payloads (`events/schema.ts`).

## Öppna frågor

- Exakt felyta/UX när grinden vägrar (`repo > kod`) i browsern — modal vs
  blockerande sida. Knyter an till bootstrap-flödet.
- Behövs ett CI-test som hashar `src/lib/shared/schemas/` och kräver en bump när
  hashen ändras brytande? (Skydd mot glömd bump.) Utvärderas i PR 2.
- Hur en redan-deployad demo (bundlad data) hanterar en framtida bump — bundlad
  data skrivs av samma build så `repo == kod` alltid, men `NEXT_PUBLIC_DEMO_VERSION`-
  cachen i OPFS måste invalideras vid bump.
