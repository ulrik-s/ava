# AVA Office-add-ins (#83)

Grunden för Word- (#84) och Outlook- (#72) add-ins, enligt
[ADR 0013](../docs/adr/0013-office-add-in-arkitektur.md).

## Arkitektur (kort)

Add-ins är **tunna tRPC-HTTP-klienter**. De äger ingen git-db, kör ingen
iso-git och rör inget filsystem. De pratar med **server-runtime:ns
tRPC-over-HTTP-API** (`/api/trpc`, Bearer-PAT, superjson) som äger `firma.git`:

```
Office-add-in (Office.js, valfri webview/OS)
   │  tRPC httpBatchLink + Authorization: Bearer <PAT>
   ▼
nginx-front  →  AVA-server (server-runtime, tRPC-over-HTTP)  →  firma.git
```

Servern är byggd och mergad (steg 1/1b/1c): se
`src/lib/server/http/` (handler, PAT, working-copy-session, node-http-adapter)
och `src/bin/server-runtime.ts` (montering + delad Mutex).

> **Scope (2026-06-14):** bara **Outlook** behövs — Word-add-in:en (#84) är
> borttagen. Outlook har två funktioner (ADR 0013): (1) spara inkommande mail →
> ärende (+ tidspost) — kräver add-in; (2) maila ut ett ärende-dokument —
> web-app-funktion (triggas i AVA, ej i Outlook).

## Vad som finns nu

- **Delad tRPC-klient** — `src/lib/client/addin/addin-client.ts`:
  `createAddinClient({ baseUrl, token })` ger en fullt typad `AppRouter`-klient,
  end-to-end-typad mot servern, superjson + Bearer-PAT. Wire-testad
  (`test/unit/client/addin/addin-client.test.ts`).
- **Testad klient-logik (CI-verifierad):**
  - `src/lib/client/graph/graph-mail.ts` — MS Graph-mail-helpers (`fetchMessageEml`
    för `$value`, `sendMail`/`createDraft`, `buildMessage`, `fileAttachment`).
  - `src/lib/client/addin/save-incoming-mail.ts` — funktion 1: `$value` → AVA
    `mail.saveIncoming` (server skriver `.eml` + tidspost i git-db, slice 1).
  - `src/lib/client/graph/mail-document.ts` — funktion 2: bifoga ärende-dokument
    + `sendMail`/`createDraft`.
- **Outlook task-pane-shell (funktion 1)** — `taskpane/taskpane.html` + `taskpane.ts`
  (tunn Office.js-glue ovanpå ovanstående). Byggs separat (ej i huvud-tsconfig):
  ```sh
  bun run office-addin/build.ts   # → office-addin/dist/{taskpane.js,taskpane.html}
  ```
- **Manifest** — `manifests/outlook-manifest.xml` (sideload-redo; `SourceLocation`
  pekar på den HTTPS-serverade bundlen).

## Token-modell

- **AVA-servern:** Bearer-PAT (klistras in i panelen, lagras i Office
  roaming-settings; ADR 0013 §3 C1).
- **Funktion 1 (MIME-hämtning):** `getCallbackTokenAsync({ isRest: true })` +
  mailboxens egen REST-URL (`Office.context.mailbox.restUrl`/v2.0) — funkar vid
  sideload **utan Azure-app-registrering**. Alternativ: Graph + SSO
  (`Office.auth.getAccessToken`) + on-behalf-of-utbyte → kräver Azure-app
  (`WebApplicationInfo` i manifestet) + server-OBO; välj det om ni vill gå via
  `graph.microsoft.com` (`fetchMessageEml` tar en `baseUrl`).
- **Funktion 2 (web-appen):** MS Graph-token via Office365-connectorn
  (`src/lib/client/integrations/office365-connector.ts`) — **MSAL ännu ej
  implementerad** (stub); det är blockeraren för web-app-knappen och hör till
  auth-infra-spåret (#221–224), inte denna add-in.

## Sideload

1. `bun run office-addin/build.ts`.
2. Servera `office-addin/dist/` över **HTTPS** (Office-krav; dev-cert à la
   `helper-app/src/tls/`). Uppdatera `SourceLocation` i manifestet till URL:en.
3. Outlook → Hämta tillägg → Mina tillägg → Egna tillägg → Lägg till från fil →
   `manifests/outlook-manifest.xml`.
4. Öppna ett mail → AVA-panelen: ange server + PAT, sök ärende, (ev.) minuter,
   **Spara**.
