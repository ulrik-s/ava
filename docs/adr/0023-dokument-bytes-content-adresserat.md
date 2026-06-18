# ADR 0023 — Dokument-bytes: innehålls-adresserade, klient-cachade, versionerade

Status: Accepterad (2026-06-18)

## Kontext

Server-first (ADR 0016) flyttade entiteterna till Postgres men lämnade
dokument-*bytes* (PDF/DOCX) i ett limbo: den gamla git-first-modellen lagrade
dem i en klonad FSA-working-copy och versionerade via git-commits — allt det
pensionerades (#420/#501/#502). `IContentStore` var en no-op och öppna/editera/
spara-flödet i koden pekade fortfarande mot den borttagna FSA-mappen.

Två sorters data kräver två cache-strategier:
- **Entiteter** (metadata) — server-Postgres, klient-cache i IndexedDB
  (`CachingSyncDataStore`), delta-synk via `change_log` (ADR 0017).
- **Bytes** (filinnehåll) — stora binärer som inte ska delta-synkas.

## Beslut

1. **Lagring:** dokument-bytes lagras i ett **git-repo** på servern
   (`AVA_CONTENT_DIR`, `GitContentStore`, #518 fas 1). En annan server kan
   `git pull` för backup; git-historik = versionering på disk. Postgres backas
   upp separat (`pg_dump`).

2. **Innehålls-adressering:** byte:s lagras under `documents/content/<sha256>`
   — **immutabelt**. En redigering skapar en NY hash → ny blob; dokumentets
   `storagePath` repekas. Gamla blobben behålls. Ger dedup + perfekt
   cache-barhet (cachen invalideras aldrig) + naturlig versionshistorik.

3. **Klient-cache:** en byte-cache i IndexedDB nyckel-ad på sha256. Läsa
   (öppna) = cache-hit eller `downloadContent` → cacha. Skriva (spara) = hasha
   lokalt → cacha → köa `uploadContent` (mutation-kön, offline-säker).

4. **Versionering:** explicit — varje `uploadContent` ger en ny version
   (`documents.version` bumpas av reconcile-konventionen; en explicit
   version→hash-lista exponeras i UI:t i ett senare steg). Konflikt mellan två
   offline-redigeringar → last-write-wins på `storagePath` men BÅDA blobbarna
   bevaras → ingen data förloras (juridiskt krav).

5. **Mekanik (server-API, denna ADR:s första steg):**
   - `document.uploadContent(documentId, contentBase64)` → content-adressera →
     `content.write` → repeka `storagePath` + bump version + `analysisStatus:
     PENDING` + trigga server-klassificering (jobb-kö).
   - `document.downloadContent(documentId)` → `content.read(storagePath)` →
     base64.
   - Binärt skickas som base64 över tRPC/JSON (`lib/shared/content-address`,
     universell sha256 + base64).

## Konsekvenser

- **Bra:** ett byte-lager med backup (git pull), versionering, dedup och en
  trivial klient-cache. Alla edit-mekanismer (helper-rundtur, ner/upp, in-app)
  landar på samma två primitiver (läs-by-hash / skriv-by-hash).
- **Pris:** klient→server byte-upload + öppna-flöde + edit-mekanik + versions-UI
  byggs i steg; `markExternallyEdited`/FSA-vägen retire:as när server-first-
  öppna-flödet är på plats.
- **Ej:** ingen klient-Postgres, ingen två-Postgres-replikering (se cache-
  resonemanget — `change_log`-sömmen är enklare och redan byggd).
