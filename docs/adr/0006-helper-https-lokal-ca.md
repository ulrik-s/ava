# ADR 0006 — Helper-HTTPS via lokal CA (mkcert-stil) för Safari/WKWebView

- **Status:** Accepterad
- **Datum:** 2026-06-08
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** helper-app (localhost-bryggan), Office-add-ins (Outlook/Word), Safari/WebKit, trust-store
- **Issue:** [#101](https://github.com/ulrik-s/ava/issues/101) (epic)
- **Relaterat:** [ADR 0005](./0005-server-som-git-peer.md) (tunn server / add-in-via-helper), [#78](https://github.com/ulrik-s/ava/issues/78) (helper → TS, sköt upp HTTPS), [#72](https://github.com/ulrik-s/ava/issues/72) (Outlook add-in)

## Kontext

Helpern lyssnar idag på `http://127.0.0.1:48761` och webbappen `fetch`:ar den därifrån. Det fungerar i **Chrome, Edge och Firefox**, som behandlar loopback-adresser (`localhost`/`127.0.0.1`) som en *secure context* — en HTTPS-sida får `fetch`:a dem utan mixed-content-block. **Windows Office-add-ins** kör WebView2 (Chromium) och omfattas av samma undantag.

**Safari/WebKit gör det inte.** En HTTPS-sida som `fetch`:ar `http://127.0.0.1` blockeras som mixed content ([WebKit #171934](https://bugs.webkit.org/show_bug.cgi?id=171934)), och Safari 18.2 lade till en osäker-anslutnings-varning som triggar på localhost ([WebKit #284559](https://bugs.webkit.org/show_bug.cgi?id=284559)). **Office-add-ins på macOS kör WKWebView** (WebKit) — så Outlook/Word-add-in på Mac ([#72](https://github.com/ulrik-s/ava/issues/72)) kan inte nå helpern över dagens HTTP. Det är det enda konkreta kravet på helper-HTTPS.

Ett **self-signed cert ensamt räcker inte**: till skillnad från sid-navigering finns ingen "fortsätt ändå"-klickväg för en bakgrunds-`fetch()` — anropet faller bara med TLS-fel. Ett betrott cert krävs.

Två vägar ger ett betrott cert:

- **A. Publikt cert på en loopback-domän** (`plex.direct`-mönstret): en domän vars DNS pekar på `127.0.0.1`, med ett riktigt Let's Encrypt-cert bundlat i binären. Funkar i alla browsers utan trust-ändringar — men kräver egen domän + DNS + cert-pipeline, att man shippar en "publik" privat nyckel (CA:er kan återkalla), och 90-dagars förnyelse.
- **B. Lokal CA injicerad i OS:ets trust-store** (`mkcert`-mönstret): helpern genererar en egen CA, utfärdar leaf-cert för localhost och lägger CA-roten i trust-storen.

## Beslut

Vi väljer **B — lokal CA (mkcert-stil)**, av-scopad till **macOS** (enda plattformen där en webview kräver det).

1. **Cert-infra (helpern).** Vid första körning genererar helpern en **lokal CA** (root cert + nyckel, lagrade i data-dir med `0600`) och ett **leaf-cert** för `localhost`/`127.0.0.1`/`::1`, signerat av CA:n. Helpern serverar **HTTPS parallellt med HTTP** (`Bun.serve({ tls })`); HTTP-porten lever kvar för Chromium/Firefox.
2. **Härdning — Name Constraints.** CA:n utfärdas med X.509 *Name Constraints* som begränsar den till `localhost`/`127.0.0.1`. En läckt CA-nyckel kan då **inte** förfalska cert för riktiga domäner — bara för loopback (där en angripare ändå behöver lokal åtkomst). Detta är striktare än vad `mkcert` gör som standard.
3. **Trust-injection — endast macOS.** CA-roten installeras i macOS-keychain (`security add-trusted-cert`) som en del av install-macos-flödet. Det kostar **en engångs-auktoriseringsprompt** (TouchID/lösenord). Avinstallation tar bort den.
4. **Web-klienten.** På WebKit/Safari pratar klienten mot `https://localhost:<port>`; på Chromium/Firefox duger HTTP-loopback som idag. Ping-logiken provar HTTPS och faller tillbaka på HTTP.

Linux- och Windows-helpers (samt Windows Office-add-ins via WebView2) fortsätter på HTTP-loopback — de behöver ingen trust-injection.

## Konsekvenser

**Positivt**
- Uppfyller add-in-kravet på Mac (#72) utan egen domän, DNS eller extern cert-infra — ligger i linje med USP:n "ingen tredjeparts-infra / tunn server" ([ADR 0005](./0005-server-som-git-peer.md)).
- Ingen publik privat nyckel att förvalta/rotera mot CA-återkallning (skillnad mot väg A).
- Begränsad blast-radius tack vare Name Constraints.

**Kostnad / risk**
- En betrodd **root-CA på användarens maskin** är en säkerhetsyta. Mildras av: per-maskin unik CA (aldrig delad/inbäddad i releasen), Name Constraints, `0600`-skydd på nyckeln, kort leaf-livslängd + rotation, tydlig logg om vad som installeras.
- **Engångsprompt** (keychain-auktorisering) vid install — sämre UX än väg A:s noll-prompt.
- Cert-generering kräver ett X.509-bibliotek i binären (`node-forge`/`@peculiar/x509`; ej system-`openssl`-beroende).
- Firefox har egen NSS-store — men Firefox behöver inte helper-HTTPS (HTTP-loopback funkar), så vi rör den **inte**.
- Underhåll: leaf-förnyelse + en avinstallations-väg som faktiskt städar trust-storen.

## Alternativ som övervägdes

- **Väg A (publikt cert på loopback-domän).** Bäst UX (noll prompts, funkar överallt) men kräver domän + DNS + Let's Encrypt-pipeline + publik privat nyckel (CA-återkallningsrisk) + 90-dagars förnyelse. Avvisad: mer rörlig infra och en publik nyckel vi måste vårda; väg B räcker för Mac-kravet.
- **Bara HTTP + Safari-fallback.** Behåll HTTP; låt Safari falla tillbaka på "Editera externt" (FSA/nedladdning). Avvisad: uppfyller inte add-in-kravet (#72), som specifikt behöver helpern i WKWebView.
- **Self-signed utan trust-injection.** Fungerar inte för `fetch()` (inget click-through). Förkastad.

## Implementation

Bryts ned i [#102](https://github.com/ulrik-s/ava/issues/102) (cert-infra + Bun.serve TLS), [#103](https://github.com/ulrik-s/ava/issues/103) (macOS trust-install/uninstall), [#104](https://github.com/ulrik-s/ava/issues/104) (web-klient https-endpoint), [#105](https://github.com/ulrik-s/ava/issues/105) (tester). Epic: [#101](https://github.com/ulrik-s/ava/issues/101).
