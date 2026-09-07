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
  (`src/lib/client/integrations/office365-connector.ts`) — MSAL implementerad i
  #1076. Rör inte denna add-in; funktion 2 triggas i web-appen.

## Värdverifiering — checklistan (#1077)

`taskpane-controller.ts` har 19 enhetstester som kör helt utan Office. Det är
rätt uppdelning, men det betyder att **de riktiga Office-API:erna aldrig bevisas
bete sig som `OfficeLike` antar**. Motsvarande lucka hos Fortnox innehöll fem
fel.

Den här checklistan är den låga ambitionsnivån ur #1077: den bevisar samma sak
som en nattlig OWA-Playwright, men bara när någon kör den. **Kör den före varje
release som rört add-in:en.** En flakig OWA-smoke som alla ignorerar är sämre än
en checklista som faktiskt följs.

### Innan du börjar

```sh
bun run addin:build        # → office-addin/dist/
bun run addin:serve        # HTTPS på :3443, skapar dev-cert, kontrollerar förtroende
```

Servern skriver ut ett `security add-trusted-cert`-kommando om certet inte är
betrott. **Kör det.** Office visar inga nätverksfel — ett cert browsern inte
litar på ger en TOM panel, utan förklaring, och då letar man efter buggar i
controllern i en timme.

Starta även en AVA-stack och ha en PAT redo:

```sh
bash tooling/scripts/selfhosted-local.sh   # eller din vanliga dev-stack
```

I **Outlook Web** fungerar `https://localhost:3443` — panelen laddas av
browsern, inte av Microsofts servrar. Ingen publik host behövs (det gäller
central utrullning, #1078).

### Sideload

1. Öppna <https://aka.ms/olksideload> (Outlook Web öppnas, dialogen dyker upp
   efter några sekunder).
2. **Mina tillägg** → längst ner **Egna tillägg** → **Lägg till ett eget
   tillägg** → **Lägg till från fil**.
3. Välj `manifests/outlook-manifest.xml`. Godkänn prompterna.
   *"Lägg till från URL" finns inte längre* — filvägen är enda vägen.

### Kör igenom, och notera VAD varje steg bevisar

| # | Gör | Bevisar |
|---|---|---|
| 1 | Öppna ett mail, öppna AVA-panelen | `SourceLocation` + certet håller; `Office.onReady` fyrar |
| 2 | Ange server-URL + PAT, spara | roaming-settings persisterar (ADR 0013 §3 C1) |
| 3 | Ladda om panelen | inställningarna kom tillbaka — annars är roaming-settings fel läst |
| 4 | Sök ärende på fritext | `matter.list` över tRPC-HTTP med Bearer-PAT fungerar från Office-iframen (CORS!) |
| 5 | Välj ärende, ange minuter, **Spara** | **`getCallbackTokenAsync({ isRest: true })` + `Office.context.mailbox.restUrl`** — de minst standardiserade delarna, och den troligaste felkällan |
| 6 | Öppna ärendet i AVA | `.eml` ligger som dokument av typen E-post, med rätt ämne |
| 7 | Ladda ner `.eml` och öppna den | rätt bytes, inte en tom eller trunkerad fil |
| 8 | Kolla tidsposten | rätt antal minuter, kopplad till ärendet |

Steg 5 är det som issuen egentligen handlar om. Steg 6–8 är read-back: att
panelen sa "sparat" bevisar inte att något rätt hamnade någonstans.

### När panelen är tom eller tyst

Office svälter fel. Öppna browserns devtools och välj task-pane-**iframen** i
frame-väljaren — konsolen i toppdokumentet visar ingenting från panelen.

| Symptom | Trolig orsak |
|---|---|
| Helt tom panel | certet inte betrott, eller `addin:serve` kör inte |
| Panelen laddar men söket ger inget | CORS eller fel server-URL/PAT |
| Spara faller på token | `getCallbackTokenAsync` — kontrollera `Permissions` i manifestet (`ReadWriteItem`) |
| Gammal kod körs | Office cachar; servern sätter `no-store`, men ta bort och sideloada om vid tvivel |

### Varför inte automatiserat (än)

OWA-inloggning i CI är sköra beroenden: MFA, ändrade selektorer, en
testanvändare som måste sakna MFA. Issuen (#1077) föreslår att ta den låga
nivån först och se om den höga bär. Går den här checklistan igenom några gånger
utan överraskningar är en nattlig Playwright värd att bygga — inte innan.

## Sideload i Outlook Desktop

Samma manifest, men via **Arkiv → Info → Hantera tillägg** (som öppnar samma
dialog i browsern). Notera att klassisk Outlook för Windows kan behöva **upp
till 24 timmar** för att visa ett manuellt sideloadat tillägg — cachning. Vill
du verifiera snabbt: använd Outlook Web.
