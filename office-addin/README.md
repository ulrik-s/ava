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

## Vad som finns nu

- **Delad tRPC-klient** — `src/lib/client/addin/addin-client.ts`:
  `createAddinClient({ baseUrl, token })` ger en fullt typad `AppRouter`-klient
  (`client.matter.list.query(...)`, `client.user.current.query()`, …),
  end-to-end-typad mot servern, med superjson + Bearer-PAT. Wire-kompatibilitet
  med servern är enhetstestad (`test/unit/client/addin/addin-client.test.ts`).
- **Manifest per host** — `manifests/word-manifest.xml`, `manifests/outlook-manifest.xml`
  (sideload-redo; `SourceLocation` pekar på en HTTPS-serverad task-pane-bundle).

## Vad som återstår (per-host feature-lager, #84/#72)

Detta kräver Office-runtime-infra som inte kan CI-verifieras utan en riktig
Office-värd, och bör därför byggas tillsammans med respektive host-add-in:

1. **Task-pane-bundle** — en HTML+JS-artefakt (t.ex. via `bun build`) som
   monterar en React-shell ovanpå `createAddinClient`. Behöver
   `@types/office-js` + `Office.onReady`/host-detektering.
2. **HTTPS-servering** av bundlen (Office kräver HTTPS vid sideload; dev-cert
   à la `helper-app/src/tls/`).
3. **PAT-inmatning/-lagring** i task-panen (användaren klistrar in sin PAT;
   lagras i add-in-roaming-settings).
4. **Host-specifik UI** — Word: infoga ärende-/malldata, spara DOCX (#84).
   Outlook: koppla mail → ärende, spara mail/bilagor (#72).

## Sideload (när en bundle finns)

- **Word:** Infoga → Mina tillägg → Ladda upp mitt tillägg → `word-manifest.xml`.
- **Outlook:** Hämta tillägg → Mina tillägg → Egna tillägg → Lägg till från fil →
  `outlook-manifest.xml`.

Båda kräver att task-pane-bundlen serveras över HTTPS på den URL som
`SourceLocation` pekar på.
