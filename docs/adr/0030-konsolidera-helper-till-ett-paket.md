# ADR 0030 — Konsolidera helpern till ETT Electron/Node-paket

- **Status:** Accepterad (2026-06-21)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** helper-app, helper-ui, paketering, self-update, CI
- **Ersätter:** sidecar-/paketerings-delen av [ADR 0029](0029-helper-electron-tray-app.md)
  (motorn som medföljande binär + child-process). Resten av 0029 (Electron-tray,
  macOS+Windows, osignerat tills cert) gäller.
- **Knyter an till:** [ADR 0028](0028-autonom-offline-first-helper.md) (motorns logik),
  [ADR 0005](0005-server-som-git-peer.md) (§Språk, TS).

## Kontext

ADR 0029 paketerade motorn (`helper-app`, Bun-binär) som en **sidecar** som
Electron-skalet (`helper-ui`) startade som child-process. Det gav **två
källpaket, två runtimes (~160 MB), två CI-jobb och två uppdaterings-vägar** —
förvirrande ("varför två saker?") och onödigt tungt nu när motorn ändå bara
levereras inbäddad i `.app`:en. Motorns Bun-yta visade sig **liten och avgränsad**
(`Bun.serve` ×3, `Bun.file`/`Bun.write` ×handfull), och en
**`node-http-adapter`** finns redan i repot (monterar en fetch-handler på en
`node:http`-server).

## Beslut

### 1. Ett paket — motorn körs IN-PROCESS i Electron (Node)

`helper-ui` blir det enda paketet. Motorns moduler (kö, content-store, auth,
`/open`/`/content`/`/config`, server-routing) flyttas in och körs i Electron-
main:ens **Node-process** — ingen medföljande binär, ingen `EngineSupervisor`,
inga `extraResources`. Localhost-servern startas via `node:http`/`https` +
`node-http-adapter` (flyttas till `src/lib/shared/http/` så helpern får importera
den). De få Bun-anropen porteras till `node:fs` / Node-`fetch`.

**Konsekvens:** en runtime (~100 MB), ett CI-jobb, en uppdaterings-väg, en
mental modell. Motorn kan inte längre köras som frristående headless-binär —
vilket vi inte längre behöver (leveransen ÄR `.app`:en).

### 2. Self-update: enkel "ny version"-notis (ingen electron-updater)

Tyst auto-update kräver signering på macOS (Squirrel.Mac) och vi har inget cert.
Därför: skalet **kollar GitHub releases** (återanvänder motorns `update`-logik:
`assetName`/`checkOnce`-mönstret) och visar **"Ny version finns — ladda ner"** i
menyraden → öppnar release-sidan. Fungerar osignerat på båda plattformar;
användaren installerar manuellt. (electron-updater/tyst uppdatering skjuts upp
till cert finns — då kan detta bytas ut.)

## Konsekvenser

- **Mindre förvirring + mindre yta:** ett paket, en runtime, ett CI-jobb.
- **Omskrivning (avgränsad):** ~8 Bun-anrop → Node; servern via befintlig adapter.
  Risk isoleras till IO-sömmarna; den testade logiken är oförändrad.
- **Test-gap:** enhetstesterna körs i Bun men koden körs i Node (Electron) —
  de rena modulerna beter sig lika; HTTP-/fs-sömmarna verifieras av att `.app`:en
  byggs + körs på måldatorn (kan ej headless-testas här).
- **`helper-app`-paketet + `helper-ci` tas bort.**

## Genomförande (en PR per steg)

1. Flytta `node-http-adapter` → `src/lib/shared/http/`; porta motorns `Bun.serve`
   → `node:http`/`https`, `Bun.file`/`Bun.write` → `node:fs`. (Kan göras i
   `helper-app` först, fortsatt grön.)
2. Slå ihop: flytta motor-modulerna in i `helper-ui`, kör servern in-process i
   Electron-main; ta bort binär/supervisor/`extraResources`.
3. Update-notis i menyraden.
4. Ta bort `helper-app` + `helper-ci`; flytta motor-testerna till `helper-ui`.

## Relaterat

ADR 0029 (Electron-tray; sidecar-delen ersatt här), 0028 (motorns logik), 0005.
Föranlett av "varför två saker?" + önskan om enkel self-update.
