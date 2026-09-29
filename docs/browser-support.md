# Webbläsarstöd

AVA stöder **de två senaste versionerna** av:

| Plattform | Webbläsare |
|---|---|
| Desktop | Chrome, Edge, Firefox, Safari |
| iOS | Safari och Chrome |

Chrome på iOS (liksom alla webbläsare på iOS) använder WebKit och räknas därför
som `iOS` (`ios_saf`) i browserslist — det finns ingen egen post för den.

## Policy och byggmål

Policyn ovan är vad AVA **stöder**. `browserslist` i
[`package.json`](../package.json) är vad bygget **riktar sig mot**, och det är
medvetet lägre versioner av samma webbläsare:

```json
"browserslist": ["chrome 111", "edge 111", "firefox 111", "safari 16.4", "ios_saf 16.4"]
```

Varför inte `last 2 Chrome versions` osv. direkt? Next 16 bygger med
Turbopack, vars inbyggda webbläsardata släpar efter (Next 16.3.x känner inte
till Chrome 146+). En version den inte känner till tolkas som en webbläsare utan
moderna funktioner, och bygget skriver då om nästan all modern syntax — i
demo-exporten 417 → 7 `class`, 2383 → 3 `??`, 1204 → 107 `async`, ~11 % större
klient-JS. Kod byggd för en äldre version körs på alla nyare, så de lägre målen
täcker policyn utan det problemet.

Två vakter håller det rätt:

- `test/unit/tooling/browserslist.test.ts` — byggmålen är exakt policyns fem
  webbläsarfamiljer, en lägsta version var, och ingen är nyare än policyns
  äldsta version ("de två senaste" räknas ur `caniuse-lite`; uppdatera den med
  `bunx update-browserslist-db@latest`).
- `bun run size` (i CI efter demo-bygget) fäller om klient-JS:en nästan saknar
  `class`, `??` eller `async` — ett omskrivet bygge
  (`tooling/scripts/modern-syntax.ts`).

Höj byggmålen först när Next/Turbopack känner till versionerna — och kör
`bun run build:demo && bun run size` för att se att bygget fortfarande är modernt.

## Funktioner som bara finns i Chromium

Funktionerna som arbetar mot en **vald mapp på datorn** bygger på File System
Access API (`showDirectoryPicker`). Det finns bara i Chromium-webbläsare
(Chrome, Edge, Opera, Brave) på desktop — inte i Firefox, Safari eller på iOS:

- redigera dokument externt och skriv tillbaka,
- öppna ett dokument i Finder/Utforskaren,
- textextraktion ur den valda mappen.

Koden kontrollerar stödet först (`isFsaSupported()` i
`src/lib/client/fsa/handle-store.ts`). Saknas det stängs funktionen av, och
Inställningar förklarar att den kräver Chrome eller Edge på desktop. Resten av
appen — IndexedDB-lagring, offline (service worker), synk — fungerar i alla
webbläsare ovan.

## Office-tilläggen

Office-tilläggen körs i Offices inbäddade webbvy: WKWebView (Safaris motor) på
Mac och WebView2 (Edge) på Windows. För Safari/WKWebView behövs helperns lokala
certifikat — se [ADR 0006](./adr/0006-helper-https-lokal-ca.md) och
[`helper-installation.md`](./helper-installation.md).

## Vad som testas

Playwright-sviterna (demo, konflikt, OIDC, server-first) kör i **Chromium**.
Firefox och WebKit testas inte automatiskt ännu — stödet där bygger på målen
ovan, inte på körda tester.
