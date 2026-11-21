# AVA Outlook-tillägget

Tillägget sparar ett inkommande mejl (`.eml`) och en valfri tidspost på ett
ärende i AVA, enligt [ADR 0013](../docs/adr/0013-office-add-in-arkitektur.md)
och [ADR 0036](../docs/adr/0036-graph-behorighetsmodell-delegerad.md). Hur det sätts upp,
rullas ut och felsöks i drift står i
[docs/outlook-addin.md](../docs/outlook-addin.md). Den här filen beskriver
delarna i koden och checklistan för att verifiera tillägget i en riktig
Outlook-värd.

## Hur det hänger ihop

```
Outlook (webben, Windows, Mac) — task-panen från https://<AVA-domän>/addin/
   │  NAA via MSAL: Outlook lämnar ut token tyst
   ├─► Microsoft Graph  GET /me/messages/{id}/$value   (Mail.Read-token)
   └─► AVA /api/trpc på samma origin                    (Authorization: Bearer <Entra-token>)
          oauth2-proxy validerar token → AVA-servern
```

- **Inloggning:** Nested App Authentication (NAA) i
  `src/lib/client/addin/addin-auth.ts`. Två token från AVA:s Entra-app:
  `api://<klient-id>/access_as_user` för AVA:s API och `Mail.Read` för Graph.
- **Mejlet:** `src/lib/client/graph/graph-mail.ts` (`messageMimeUrl`, Graph
  `$value`) och `src/lib/client/addin/save-incoming-mail.ts`, som skickar
  `.eml` + tidspost till `mail.saveIncoming`.
- **AVA:s API:** `src/lib/client/addin/addin-client.ts`, en typad tRPC-klient
  mot `/api/trpc` med Entra-token som Bearer.
- **Panelen:** `taskpane/taskpane.html` + `taskpane.ts` (Office.js-glue) ovanpå
  `src/lib/client/addin/taskpane-controller.ts`.
- **Manifest och konfiguration:** `office-addin/manifest.ts` genererar
  `manifest.xml` ur `manifests/outlook-manifest.xml` och `config.js` (klient-id,
  tenant) per installation.

Den tidigare modellen med personlig token och Outlooks egna REST-gränssnitt är
borttagen; se [docs/outlook-addin.md](../docs/outlook-addin.md) ("Varför NAA och
Graph").

## Bygga och köra lokalt

```sh
bun run addin:build        # → office-addin/dist/ (bas-URL https://localhost:3443)
bun run addin:serve        # HTTPS på :3443, skapar dev-cert, kontrollerar förtroende
```

Deployen bygger med `bun office-addin/build.ts --out out/addin` och serverar
tillägget på `https://<AVA-domän>/addin/`. För utveckling utan Outlook kan
`config.js` ha fasta token (`staticTokens` i `addin-auth.ts`), som E2E:n gör.

## Värdverifiering — checklistan (#1077)

`taskpane-controller.ts` har enhetstester som kör helt utan Office, och E2E:n
kör panelen i Chromium och WebKit (`docs/quality.md`, *Outlook-tillägget i CI*).
Det som inte täcks är att **Outlooks riktiga Office.js och NAA beter sig som
koden antar**. Det bevisar bara en genomgång i en riktig Outlook-värd. **Kör
den före varje release som rört tillägget**, i varje Outlook-variant i
resultattabellen.

### Innan du börjar

- Tillägget är utrullat enligt [docs/outlook-addin.md](../docs/outlook-addin.md)
  ("Utrullning") och syns i Outlook för ditt konto.
- Kontrollen efter deploy i samma dokument ("Servern") ger rätt `config.js` och
  `manifest.xml`.
- Ditt konto finns som aktiv användare i AVA, och det finns ett ärende att spara på.

### Kör igenom, och notera VAD varje steg bevisar

| # | Gör | Bevisar |
|---|---|---|
| 1 | Öppna ett mejl, öppna AVA-panelen | panelen laddas från `https://<AVA-domän>/addin/` och `Office.onReady` fyrar |
| 2 | Vänta på raden överst | *"Inloggad som …"* visas utan inloggningsruta: NAA lämnar ut token tyst |
| 3 | Sök ett ärende på fritext | AVA:s API tar emot Entra-token (Bearer-vägen genom oauth2-proxy) |
| 4 | Välj ärende, ange minuter och beskrivning, **Spara** | *"✓ Sparat i …"*: Graph `$value` med `Mail.Read` fungerar i värden |
| 5 | Öppna ärendet i AVA | `.eml` ligger som dokument av typen E-post med rätt ämne; den nedladdade filen är hel; tidsposten har rätt minuter och är kopplad till ärendet |
| 6 | Spara samma mejl igen | *"Mejlet fanns redan i …"*: dubblettskyddet |

Steg 5 är read-back: att panelen sa "sparat" bevisar inte att något rätt
hamnade någonstans. I steg 6 kan panelen redan när ärendet väljs säga *"Mejlet
finns redan i …"* och låta **Spara** vara gråmarkerad; det är samma skydd.

### När panelen är tom eller tyst

Felmeddelandena i panelen och deras orsaker står i
[docs/outlook-addin.md](../docs/outlook-addin.md) ("Om något inte fungerar").
För själva genomgången:

- Office visar inga nätverksfel. Öppna browserns devtools och välj
  task-pane-**iframen** i frame-väljaren; konsolen i toppdokumentet visar
  ingenting från panelen.
- Office cachar panelen. Servern sätter `no-store`, men vid tvivel: stäng och
  öppna Outlook, eller ta bort tillägget och lägg till det igen.

### Resultat per Outlook-variant

Fyll i en rad efter varje genomgång (skriv över den gamla).

| Outlook-variant | Datum | AVA-version | Resultat | Anteckning |
|---|---|---|---|---|
| Outlook på webben | | | Ej genomgången | |
| Nya Outlook för Windows | | | Ej genomgången | |
| Outlook för Mac (nya) | | | Ej genomgången | |

### Varför inte automatiserat (än)

Inloggning i Outlook på webben i CI är sköra beroenden: MFA, ändrade
selektorer, en testanvändare som måste sakna MFA. Issuen (#1077) föreslår att ta
den låga nivån först och se om den höga bär. Går checklistan igenom några gånger
utan överraskningar är en nattlig Playwright värd att bygga, inte innan.
