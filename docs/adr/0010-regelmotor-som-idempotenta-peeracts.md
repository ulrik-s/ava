# ADR 0010 — Regelmotor som idempotenta schemalagda PeerActs

- **Status:** Accepterad
- **Datum:** 2026-06-11
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** server-runtime (ADR 0005), påminnelser (#71), framtida automatiseringar
- **Issue:** [#80](https://github.com/ulrik-s/ava/issues/80)
- **Relaterat:** [ADR 0005](./0005-server-som-git-peer.md) (git-peer-server), [ADR 0002](./0002-git-konflikthantering-backend-a.md) (konflikthantering), [#71](https://github.com/ulrik-s/ava/issues/71), [#82](https://github.com/ulrik-s/ava/issues/82)

## Kontext

`paymentPlan.scanDueReminders` (förfallo-/förseningspåminnelser) finns och är
testad men kördes bara manuellt (#71 gav en knapp). Vi vill att schemalagda
regler körs **automatiskt** på servern. Problemet i local-first: det finns
ingen server-cron och ingen dataägande server — bara git-peers (ADR 0005).

Frågan har väntat på "den vilande regelmotorn" (scheduler-tick + event-dispatch).
Nu när server-runtime:n (#77/#81) + dess konflikt-säkra peer-loop + PeerAct-
mönstret (Fortnox #82) finns, kan vi besvara den utan ny infrastruktur.

## Beslut

**Regelmotorn = idempotenta regler som körs som en `PeerAct` på server-runtime:ns
peer-tick.** Ingen separat scheduler, ingen separat event-buss.

- **Schemaläggning = peer-tick:en.** Loopen tickar redan periodiskt (#81). Varje
  tick kör regel-acten mot working-copy:ns tRPC-caller.
- **Idempotens i stället för schemaläggnings-state.** Reglerna skapar varje
  effekt högst en gång (t.ex. `scanDueReminders` nycklar påminnelser på
  plan+månad+typ). Att köra varje tick är därför säkert; cadensen blir naturligt
  "en gång per förfallomånad" utan att persistera "senast körd". Detta speglar
  konflikt-säkerheten i ADR 0002 (additivt + nyckel-baserat).
- **No-empty-commit-grind.** `runPeerCycle` committar/pushar nu bara om
  `git status` visar ändringar (`NodeGitOps.hasChanges()`). En alltid-på regel
  utan nya effekter ger alltså inga tomma commits varje tick (returnerar
  `{ noop: true }`). Gäller även Fortnox-connectorn.
- **Flera regler/connectors i samma cykel.** `composeJobs([...])` kör flera
  `PeerJob`-`act`:er i sekvens mot samma caller → en commit per tick som
  innehåller summan (regelmotor + Fortnox + framtida). Ej-konfigurerade jobb
  (null) filtreras bort.
- **Event-dispatch = befintliga emits.** Reglerna anropar routrar som redan
  emit:ar domänhändelser (`scanDueReminders` → `paymentDue`/`paymentOverdue`
  via den skrivbara event-loggen). Ingen separat dispatch behövs.

Regelmotorn är **alltid på** när server-runtime:n körs (kärnfunktion, ej
integrations-gated som Fortnox).

## Konsekvenser

- **+** Noll ny infrastruktur — återanvänder peer-loop + PeerAct + emits.
- **+** Robust mot omkörning/konflikt (idempotent + ADR 0002).
- **+** No-empty-commit-grinden gör en hög-frekvent tick ofarlig (ingen
  commit-spam) och förbättrar även Fortnox-connectorn.
- **+** Utbyggbart: nya regler = utöka `runRules`; nya connectors = `composeJobs`.
- **−** Cadensen är knuten till tick-intervallet (default 15 s) snarare än en
  cron-spec. För regler som MÅSTE köra på en exakt tid (ej fallet för
  påminnelser) behövs framtida tid-grindning i regeln själv.
- **−** Regler delar en commit per tick → blandade ändringar i en commit. OK
  givet additiv modell; kan delas upp per regel senare om spårbarhet kräver.

## Alternativ (förkastade)

- **Separat scheduler-tjänst/cron** — ny alltid-på-komponent, bryter "tunn
  server" + saknar plats i local-first (ingen dataägare). Nej.
- **Browser-open-job** (#71-alternativet) — kräver att job-queue-worker:n wiras
  och att en flik är öppen; opålitligt för tidskänsliga påminnelser. Behålls som
  komplement (manuell knapp finns), ej primär väg.
- **Persistera "senast körd"-state** — onödigt när reglerna är idempotenta;
  undviker en state-fil som ändå skulle nollställas av `resetHardToRemote`.
