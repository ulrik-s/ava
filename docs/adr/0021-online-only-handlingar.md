# ADR 0021 — Online-only-handlingar (kö-modell + UI) i offline-first-klienten

- **Status:** Accepterad
- **Datum:** 2026-06-17 (accepterad 2026-06-18)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** offline-first-klient, server-runtime, integrationer (mail/Fortnox/webhooks), sync, UI
- **Issue:** [#407](https://github.com/ulrik-s/ava/issues/407) (design; blockerar #417-implementationen)
- **Bygger på:** [ADR 0016](0016-server-first-med-offline-first-klient.md) (server-first +
  offline-first; beslut 3 "online-only-handlingar" konkretiseras här),
  [ADR 0017](0017-sync-reconcile-protokoll.md) (mutations-kö + reconcile, idempotens via UUIDv7).
- **Knyter an till:** [ADR 0005](0005-server-som-git-peer.md) (peer-loop-workers),
  [ADR 0011](0011-pluggbar-ledger-connector.md) (Fortnox/ledger), [ADR 0009](0009-oidc-login-via-servern.md).

## Kontext

ADR 0016 beslut 3 fastslog principen men sköt upp detaljerna: vissa handlingar
kan inte ske offline (kräver nät/extern tjänst) → de **köas och körs vid
återanslutning**, med tydlig UI ("skickas när du är online igen"). Den rena
gränsen: *föra tid / skriva utkast / läsa = helt offline; skicka/boka externt =
köas*.

Den här ADR:n konkretiserar (a) **vilka** operationer som är online-only, (b)
**kö-semantiken** (var kön bor, idempotens, retry), och (c) **UI-mönstret** —
så #417 kan implementeras.

**Nyckelinsikt (server-first ändrar var kön bor):** i den server-auktoritativa
modellen är **servern alltid online**. Klienten är offline-first; servern är det
inte. De flesta "online-only-handlingar" är därför inte en separat *klient*-kö —
de är **server-sidiga reaktioner på synkat state**. Mönstret finns redan i koden:
`invoiceDispatch`-workern (`integrations/email/dispatch-job.ts`) läser rader med
status `queued`, skickar via SMTP server-side, och stämplar `sent`/`failed`
**idempotent** (bara `queued` plockas → ofarligt vid omkörning). Klienten gjorde
bara en vanlig data-mutation (skapade dispatch-raden); den synkas via den vanliga
mutations-kön (ADR 0017); servern reagerar.

## Beslut (föreslaget)

### 1. Modellera online-only-handlingar som **köat data-state + idempotent server-worker**

Default-mönstret (dispatch-job-mönstret) för ALLA externa sido-effekter:

1. Klienten gör en **data-mutation** som uttrycker *avsikten* (t.ex. en
   `invoiceDispatch`-rad `queued`, `fortnoxPush`-rad `pending`). Detta är vanligt
   offline-arbete → hamnar i mutations-kön (ADR 0017) och synkas normalt.
2. En **idempotent server-worker** (peer-loop-job / reaktion) plockar
   öppna rader, utför det externa anropet, och skriver tillbaka utfallet
   (`sent`/`failed` + `messageId`/`error`).
3. Idempotens: bara öppna rader plockas; UUIDv7-id (ADR 0003) → ingen
   dubbelkörning vid replay/omkörning. Retry med backoff på `failed` (speglar
   `useAutoSync`-backoffen — dubbla intervallet upp till ett tak).

Detta gör "online-only" till en **statemaskin + worker**, inte en ny
klient-infrastruktur. Återanvänder reconcile-idempotensen och no-empty-commit-
grinden.

### 2. Operationerna (v1.1-ytan)

| Operation | Trigger-state | Worker | Anm. |
|---|---|---|---|
| **E-postutskick (SMTP)** | `invoiceDispatch.queued` | dispatch-job (finns) | mönster-exemplet |
| **Fortnox-push (voucher/faktura)** | bokförings-/push-state | fortnox-runtime (finns) | poll-baserad idag (ADR 0011) |
| **Bankfil/ledger-hämtning** | inbox/connector-state | bank-file-runtime (finns) | inbound, schemalagt |
| **Webhook-mottagning** | — (inbound) | webhook-endpoint (#219) | server-side, ej klient-kö |
| **OIDC-token-refresh** | session-state | auth-lagret (ADR 0018) | server/refresh-token |

Alla utom rena *klient-kommandon* (se 3) faller ut som server-state + worker.

### 3. Undantag: rena klient-kommandon utan data-state

Ett fåtal handlingar är explicita kommandon utan ett naturligt data-state att
synka (t.ex. "skicka om det här mejlet NU"). För dem: uttryck dem ändå som
state där det går (skapa en ny dispatch-rad i st.f. ett free-floating-kommando).
**Föreslås:** undvik en separat klient-kommando-kö helt — om en handling är värd
att köa offline är den värd ett spårbart state. (Öppen fråga om något kommando
inte kan modelleras som state.)

### 4. UI-mönster ("skickas när du är online igen")

Återanvänder sync-status-UI:n (ADR 0016/#416, byggd):

- **Global:** `SyncStatusPill` visar redan köat/offline-läge. Externa
  väntande-handlingar ryms i samma "X ändringar väntar".
- **Per post:** `QueuedBadge` (`köad` / `synkad` / `konflikt`) på t.ex. en faktura
  vars utskick väntar. Lägg ett `pending`/`failed`-tillstånd för externa anrop
  (utöver sync-status) så användaren ser "skickas när du är online igen" och, vid
  `failed`, "försök igen".
- **Dead-letter:** efter N misslyckade retries → ytlägg som ett åtgärdbart fel
  (banner/lista), aldrig tyst tappat.

## Konsekvenser

**Positivt**
- Ingen ny klient-infrastruktur: online-only = statemaskin + idempotent worker,
  ett mönster som redan finns och är testat (dispatch-job).
- Idempotens + retry ärvs från reconcile-modellen (ADR 0017) och peer-loop-grinden.
- UI återanvänder `SyncStatusPill`/`QueuedBadge` → konsekvent mental modell.
- Servern (alltid online) äger det externa anropet → klienten behöver aldrig nät
  för annat än sync.

**Negativt / risker**
- "Allt är state" kräver att varje extern handling har ett spårbart data-state;
  designen måste bevaka att inget kommando smiter förbi som en free-floating-
  sidoeffekt (lint/review).
- Fördröjning: en extern handling sker först efter att triggern synkats *och*
  workern kört → UI måste tydligt skilja "köad lokalt" → "synkad" → "skickad".
- Retry/backoff + dead-letter-yta är reellt arbete i #417.

## Öppna frågor (till #417 / kräver din avstämning)

- **Finns det ett klient-kommando som INTE kan modelleras som data-state?** Om ja,
  behövs en liten kommando-kö ändå — annars håller vi "allt är state".
- **Retry-policy:** max antal försök + backoff-tak per operationstyp (mail vs
  Fortnox) innan dead-letter.
- **UI-yta för dead-letter:** banner, dedikerad lista, eller per-post-fel.
- **Webhook (#219):** inbound-skydd (signatur) hör hit men är en egen endpoint —
  bör #219 dras in i #417 eller hållas separat?
