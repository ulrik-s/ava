# ADR 0025 — Demon som cache-hydrerad offline-klient

Status: Accepterad (2026-06-19)

## Kontext

Server-first (ADR 0016) gjorde web-klienten offline-first: den läser/skriver mot
en lokal `CachingSyncDataStore` (LocalStore-kärna + IndexedDB-snapshot +
`MutationQueue`) och synkar mot servern via `reconcile()` (pull→apply→replay→
advance, ADR 0017) bakom en transport-söm — `SyncTransport { pull, push }`.
Self-hosted injicerar en tRPC-transport; demon injicerar `noSyncTransport`
(no-op).

Demon (GH Pages) kör alltså **redan** samma store/cache/kö som den riktiga
klienten — det är inte längre en separat datalager-väg som i den gamla
git-first-demon. MEN cachen *seedas* fortfarande på ett eget sätt:

- **Riktig klient:** `reconcile → transport.pull(cursor) → applyPull →
  writeCanonical → persist`.
- **Demo:** en separat `seed`-option på `CachingSyncDeps` + `loadDemoSeed()` som
  hämtar `manifest.json` + N JSON-filer från CDN:n och injiceras direkt i
  LocalStore — **förbi** pull/apply-vägen.

Det är två kodvägar för samma sak (populera cachen), och demon övar aldrig den
riktiga reconcile-vägen.

## Beslut

**Hydrera demons cache genom den riktiga reconcile/pull-vägen.** Ersätt
`seed`-optionen + `loadDemoSeed`/manifest med en **`StaticSyncSource`** som
implementerar `SyncTransport`:

- `pull(0)` returnerar den bundlade `DemoSource` plattad till `PulledChange[]`
  (cursor = N).
- `pull(n>0)` returnerar loopback-ändringar med seq > n.
- `push(mutation)` ack:ar (`accepted`) **och** lägger raden i loggen så nästa
  `pull` serverar tillbaka den.

Demon blir en självständig **loopback-"server"** i klienten. Bygget emit:ar en
`demo-seed.json`-artefakt; klienten själv-hydrerar IndexedDB vid första
laddningen via pull-vägen (engångs, version-gated av `NEXT_PUBLIC_DEMO_VERSION`).

### Två mål, ett grepp

1. **Färre kodvägar** — `seed`-optionen, `demo-seed-loader.ts` och
   manifest-genereringen/-hämtningen försvinner; cache-populering enas på
   reconcile-vägen.
2. **Bevisad cache** — varje demobesök övar `reconcile()` pull→apply→persist→
   replay→ack på riktigt, i produktion. Loopback-pushen gör att mutations-kön
   faktiskt dräneras (annars växer den obegränsat utan server) och att en pull
   ser klientens egna tidigare ändringar.

## Konsekvenser

- **Cold-start-UX ändras (till det ärligare):** demon går tom → reconcile →
  populerad i st.f. att pre-seedas synkront. Det är samma initial-load-väg som
  riktiga klienten redan har → ev. loading-state-buggar syns i demon i st.f. att
  döljas.
- **Vad det bevisar:** klient-halvan (offline-store + sync-*klient*:
  apply/replay/cursor/ack). **Inte** serverns `change_log`/seq-generering, äkta
  samtidig konfliktreconcile, oauth2-proxy-auth eller server-side byte-lagring —
  de täcks fortsatt av docker-e2e (#527/#531). Demon är ett *levande test av
  klient-cachen*, komplement till — inte ersättning för — server-e2e.
- **Versionering/reset:** oförändrat — `NEXT_PUBLIC_DEMO_VERSION` ger cache-
  nyckeln; redeploy → ny nyckel → re-hydrering; reset-demo rensar cachen.
- **Dokument-bytes (ADR 0023)** är en separat väg (content-sync, byte-cache) som
  entitets-reconcile inte bär. Steg 3 (#545) hydrerar byte-cachen via en
  parallell `StaticContentSource` så även byte-vägen bevisas.

## Genomförande (en PR per steg)

1. `StaticSyncSource` + denna ADR + enhetstester (#543) — ingen wiring-ändring.
2. Wira `createDemoStore` → `StaticSyncSource`; ta bort `loadDemoSeed`/manifest;
   bygget emit:ar `demo-seed.json` (#544).
3. Byte-cache-hydrering via `StaticContentSource` (#545).

## Relaterat

ADR 0016 (server-first), ADR 0017 (reconcile/cursor), ADR 0023 (dokument-bytes),
ADR 0004 (demo-cache-versionering). Epic #542.
