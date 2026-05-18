# AVA — Framtida arkitektur

> **Status:** designdokument. Beskriver målbilden vi enats om i diskussioner
> 2026-05-10 till 2026-05-15. Nuvarande kodbas (Postgres + Next-server + WebDAV)
> beskrivs i [`architecture.md`](./architecture.md) — denna fil är **inte** en
> beskrivning av vad som körs idag.

AVA distribueras i framtiden i **två deployment-lägen** från **samma kodbas**.
Varje byrå väljer vilket som passar dem:

| Läge | Vem driftar | Var bor data | Klient-typ |
|---|---|---|---|
| **Local-first (tunn server)** | Byrån själv på SSH-server | Git-repo per byrå | Web + Tauri |
| **Server-baserad (tjock server)** | AVA-leverantör eller byrån själv | PostgreSQL på server | Web (pure SPA) |

Båda lägen delar:

- 100 % av UI-koden (Next-app, samma routes)
- ~95 % av tRPC-routrarna (samma Zod-scheman; olika `DataStore`-adapter)
- 100 % av regelmotorn och event-loggen
- 100 % av domänmodellen (Prisma-schema är källan)

Skillnaden är **datalager-adapter och sync-mekanism**.

---

## 1. Motivering

Två orelaterade krav drev fram två lägen:

### 1.1 Krav från advokat-byråer

- **Sekretess utan kompromiss:** klientdata får aldrig lämna byråns kontroll.
- **Inga månadsavgifter:** byrån vill äga sin installation.
- **Mobil tillgång till befintliga data:** iPad/iPhone via browser.
- **Begränsad teknisk förmåga:** användare kan inte lösa merge-konflikter.
- **Audit i 50 år:** advokatregler kräver långtidsbevarad ändringshistorik.

Detta pekar mot **local-first** med git som sanning.

### 1.2 Krav för organisationer med IT-resurser

Vissa byråer vill ha:

- **Real-time samarbete** (Anna ser Björns ändring inom 100 ms)
- **Tunga rapporter över allt data** (SQL-aggregation över flera år)
- **Web-only utan installation** på alla enheter
- **Centraliserad drift** av en IT-leverantör

Detta pekar mot **server-baserad** drift med PostgreSQL.

### 1.3 Beslut

Bygg **båda från samma kodbas**. Det krävs en `DataStore`-abstraktion;
resten av koden är lägesoberoende.

---

## 2. Gemensamt fundament

### 2.1 Event-log som förstklassig medborgare

Allt som händer i systemet skrivs som ett event innan det manifesteras i
datalagret. Event-loggen är **append-only** och fungerar som:

- Source of truth för audit
- Trigger för regelmotorn
- Underlag för rerun/debug
- Mekanism för sync i local-first-läget

#### Event-schema

```ts
type AvaEvent = {
  id: string;                // UUID v7 (kronologiskt sorterbar)
  ts: string;                // ISO 8601 timestamp
  type: string;              // dotted: "matter.created", "mail.received"
  source: "ui" | "mail" | "file" | "rule" | "system" | "schedule";
  actor: { kind: "user" | "rule" | "system"; id: string };
  matterId?: string;         // valfri primary context
  causedBy?: string;         // event-id som triggade detta (kausalkedjor)
  payload: Record<string, unknown>;
};
```

#### Event-typer (initial inventering)

```
matter.created                  matter.updated              matter.status_changed
matter.archived                 contact.created             contact.updated
document.uploaded               document.deleted            document.analyzed
mail.received                   mail.sent
invoice.created                 invoice.sent                invoice.payment_received
invoice.overdue
time-entry.added                time-entry.updated
task.created                    task.completed
rule.executed                   rule.failed
user.logged_in                  user.action                 system.heartbeat
```

#### Lagring

- **Local-first-läget:** `.ava/events/<yyyy>/<mm>/<dd>.jsonl`, en rad per event
- **Server-läget:** tabell `events` i Postgres + utskrift till disk för audit-export

Båda lägen exponerar samma API: `emitEvent(type, payload, opts)`.

---

### 2.2 Regelmotor

Affärslogik som *kan* uttryckas deklarativt **bör** uttryckas som regler. Allt
annat förblir TypeScript i tRPC-routrar. Vendorn (du) skriver reglerna initialt;
användare kan välja och konfigurera per-användare-regler senare.

#### Regelschema

```ts
type AvaRule = {
  id: string;
  name: string;
  description?: string;
  ownerId: string;            // "anna" | "_org" — metadata, inte exekverings-gate
  enabled: boolean;

  trigger:
    | { kind: "event"; type: string; predicate?: JsonLogic }
    | { kind: "schedule"; cron: string; timezone?: string }
    | { kind: "http"; method: "GET"|"POST"; path: string; auth: "user"|"shared-secret"|"none" };

  steps: RuleStep[];
};

type RuleStep =
  | { do: "emit"; eventType: string; payload: Json }
  | { do: "email.send"; template: string; to: string; vars?: Json; idempotencyKey?: string }
  | { do: "matter.update"; matterId: string; patch: Json }
  | { do: "matter.attach_mail"; matterId: string; mailRef?: string }
  | { do: "document.tag"; documentId: string; tags: string[] }
  | { do: "llm.extract"; documentId: string; schema: Json; into: string }
  | { do: "task.create"; assignTo: string; title: string; dueAt?: string }
  | { do: "audit.log"; message: string }
  | { do: "http.respond"; status: number; body?: Json }
  | { do: "if"; cond: JsonLogic; then: RuleStep[]; else?: RuleStep[] }
  | { do: "for-each"; items: JsonPath; as: string; body: RuleStep[] };
```

Predikat-språk: **[JsonLogic](https://jsonlogic.com/)** (MIT). Steg-värden får
använda `{{var}}`-substitution mot event-payload och kontext.

#### Lagring

- **Local-first:** `.ava/rules/<owner>/<rule-id>.json`
- **Server:** tabell `rules` i Postgres

#### Exekvering

- **Local-first:** alla klienter kör alla enabled-regler. Konkurrens hanteras via
  claim-commits (se §3.3). `ownerId` är metadata, inte filter.
- **Server:** en singel rule-executor som processar event-strömmen. Inga claims
  behövs eftersom det finns en koordinator.

I båda fall kör steg-interpretern samma kod; bara `tryClaim()`-pre-steget skiljer.

#### Dynamiska HTTP-routes från regler

Catch-all i Next App Router:

```
src/app/api/r/[...path]/route.ts
```

Forwardar till `handleRuleRequest(req, path)` som letar regler med
`trigger.kind === "http"` matchande sökväg och metod. Resultat: en *commit som
lägger till en regel* registrerar samtidigt en ny endpoint utan deploy.

---

### 2.3 Domänmodell

Prisma-schemat är källan oavsett deployment-läge. I local-first läget styr det
SQLite, i server-läget Postgres. Modellnamn, fält, relationer identiska.

Multi-tenant-fältet `organizationId` finns kvar i schemat **men används bara i
server-läget**. I local-first läget = ett repo per byrå, så fältet är alltid
samma värde och kan ignoreras runtime.

---

## 3. Local-first-läget (tunn server)

### 3.1 Designprincip

> **"Git-repot är sanningen. Klienten har en clone. Allt som ändrar filerna är
> giltig input — appen själv, Finder, Word, kommandoraden, kollegans `git push`."**

### 3.2 Stack — klient

Hela klienten kan distribueras som Tauri-app (desktop), pure web (iPad, mobile,
Chromebook) eller båda. Samma Next.js-kod renderar UI:t.

```
┌─ Klient (Tauri eller browser) ─────────────────────────┐
│  Next.js (samma kod båda läge)                         │
│  ├── tRPC mot localhost (Tauri) eller in-process (web) │
│  ├── SQLite — hydratiserad cache av JSON-filer         │
│  ├── isomorphic-git — clone/pull/push                  │
│  ├── Meilisearch / SQLite FTS5 — sök                   │
│  ├── Tika / PDF.js — textextraktion                    │
│  ├── Ollama / WebLLM — LLM (opt-in på desktop)         │
│  ├── Yjs — CRDT på fri-text-fält (notes, kommentarer)  │
│  └── fs-watcher / FileSystemObserver — fångar ändringar│
└────────────────────────────────────────────────────────┘
```

#### Platform-matris

| Enhet | Stöd | Hur |
|---|---|---|
| macOS / Windows 11 / Linux desktop | ✅ Native | Tauri-bundle |
| iPad / iPhone | ✅ Web | Browser, OPFS-baserad lagring |
| Android | ✅ Web | Browser, File System Access API |
| Mobil + own desktop | ✅ Web via Tailscale | Browser pekar mot din egen Mac |

### 3.3 Stack — server

```
┌─ Server: en SSH-uppkopplad Linux-låda ─────────────────┐
│  sshd (OpenSSH-server)                                  │
│  git + git-lfs + git-lfs-transfer                       │
│  cron (nightly rsync till backup-host)                  │
│  certbot + nginx (om HTTPS-clone önskas för web)        │
│                                                         │
│  /srv/git/<byrå-id>.git    bare git-repo                │
│  /home/git/.ssh/authorized_keys                         │
└─────────────────────────────────────────────────────────┘
```

**Inga applikations-daemons.** Bara sshd + git. Underhåll = vanliga
Debian-säkerhetsuppdateringar. Auth = SSH-nycklar listade i
`.ava/users/<user>.json` i repot; en `post-receive`-hook regenererar
`authorized_keys` vid varje push.

### 3.4 Filstruktur i repot

```
firma-x.git/
├── matters/
│   ├── active/                    pågående ärenden (alltid checked out)
│   │   ├── 2026-0001.json
│   │   └── ...
│   └── archive/<år>/              stängda, per år
│
├── events/<år>/<mm>/<dd>.jsonl    append-only event-logg
├── claims/<år>/<mm>/<dd>.jsonl    append-only claim-logg (en rad per claim)
│
├── contacts/                      *.json, alltid checked out
├── time-entries/<år>/<mm>/<user>.jsonl
├── invoices/
├── tasks/
│
├── documents/<matter-id>/         LFS-trackade binärer (PDF/DOCX/JPG/PNG)
│
└── .ava/
    ├── users/<user>.json          konton + SSH-keys
    ├── rules/<owner>/<rule>.json
    ├── audit/                     extra spår (regelförsöksloggar etc.)
    └── config.json                byrå-config (locale, paths, etc.)
```

#### Sparse-checkout — "senaste 12 månader"

Standardflödet vid clone:

```bash
git clone --filter=blob:none ssh://git@server/srv/git/firma-x.git
cd firma-x
git sparse-checkout init --cone
git sparse-checkout set \
  matters/active matters/archive/<senaste-året> \
  events/<senaste-året> claims/<senaste-året> \
  documents \
  contacts time-entries/<senaste-året> invoices tasks \
  .ava
```

Resultat: aktivt arbete tar ~50–100 MB JSON-data + ~5–20 GB dokument på disk.
Äldre data ligger i historiken men kostar 0 byte tills användaren ber om det.
"Hämta historik från 2018" = `git sparse-checkout add matters/archive/2018
events/2018 documents/2018-*` → klart på ~2 sekunder.

### 3.5 Sync-protokoll

```
Klient pollar var 15:e sekund:
  1. git fetch                                  (~100–300 ms)
  2. Om HEAD ändrats:
     a. För varje ny event i events/.../*.jsonl → hydrate SQLite, reindex Meili
     b. För varje matchande regel → tryClaim() → execute → emitt nytt event
  3. Om lokala ändringar:
     a. fs-watcher har commitat under 5-sek-debounce
     b. git push (med retry-på-conflict)
```

### 3.6 Konflikt-elimination (fyra lager)

Användarna ska **aldrig** se en merge-konflikt:

1. **Per-entity files.** Olika ärenden = olika filer = ingen konflikt.
2. **Append-only JSONL** för logs (events, claims, time-entries, payments,
   audit). Git's 3-way merge accepterar bägge tilläggen trivialt.
3. **Yjs-CRDT** på fri-text-fält (matter-anteckningar, kommentartrådar).
   Auto-merge transparent.
4. **Optimistic retry** för strukturerade fält. Vid sista-vinner-konflikt:
   audit-rad i event-loggen, ingen användardialog.

### 3.7 Claim-mekanismen (för regel-konkurrens)

Eftersom alla klienter kör alla regler måste exakt-en-gång-semantik säkras.
Lösning: anspråksmärken som JSONL.

#### Claim-format

`claims/<år>/<mm>/<dd>.jsonl`, en rad per claim:

```jsonl
{"claimId":"rule:anna/payment-reminder-daily@evt-01H...","claimedBy":"anna","at":"2026-05-15T09:00:00Z","expiresAt":"2026-05-15T09:05:00Z"}
{"claimId":"rule:_org/extract-contract@evt-01J...","claimedBy":"bjorn","at":"2026-05-15T09:00:03Z","expiresAt":"2026-05-15T09:05:03Z"}
```

#### Claim-algoritm

```ts
async function tryClaim(claimId: string): Promise<boolean> {
  // Skriv en claim-rad till dagens claim-logg, commit, push.
  // Git's CAS avgör vem som vinner.
  appendToTodaysClaimLog({ claimId, claimedBy: me, at: now(), expiresAt: now() + 5min });
  await git.commit(`claim: ${claimId}`);
  try {
    await git.push();
    return true;
  } catch (NonFastForward) {
    await git.resetHardOriginMain();
    return claimExistsAndIsOurs(claimId);
  }
}
```

#### Stale-claim failover

En claim har 5 min TTL. Om en klient lyckas claima men kraschar innan motsvarande
`rule.executed`-event commitas, kan en annan klient re-claima efter TTL:

```ts
function isClaimable(claimId: string): boolean {
  const existing = findInClaimsLogs(claimId);
  if (!existing) return true;
  if (existing.expiresAt < now() && !hasExecutedEvent(claimId)) return true;
  return false;
}
```

#### Preferred-runner (krav, inte optimering)

Spike i `spikes/claim-race/` (2026-05-18) visade att utan denna mekanism får
vi avg 10 retries per claim under konkurrens (p95 = 82). Med den: avg 1.27,
p95 = 2. Det är 8× snabbare och nödvändigt vid burst-scenarier.

Insikt från spiken: git CAS sker på `refs/heads/main`-nivå, inte fil-nivå.
Att splitta claims över olika filer hjälper inte; bara reducerad konkurrens
gör det.

```ts
const primary = activeUsers.find(u => hash(u + event.id) === minHash(event.id));
const delay = (me === primary) ? 0 : 15_000 + jitter(0..5_000);
setTimeout(() => tryClaim(claimId), delay);
```

Primary försöker direkt. Övriga väntar 15–20 s. Resultat: 95 % av tiden en
ensam push. Backup tar över om primary är offline.

### 3.8 Identitet och behörigheter

- **Användare:** `.ava/users/<email>.json` med fält `{ name, role, ssh_public_keys[], lastSeen }`
- **Auth:** SSH-nycklar (eller WebAuthn/passkeys för pure-web). Forgejo *inte*
  använt — för komplext för "ingen servermjukvara"-kravet.
- **Behörigheter:** en byrå = ett repo = SSH-listan i det repot. Internt
  förtroende. För separationer mellan byråer: separata repos.
- **Admin:** klona repo, lägg till en user-JSON, push:a. `post-receive`-hook
  regenererar `authorized_keys` på servern.

### 3.9 Filsystemet är mounten (ersätter WebDAV)

Eftersom klienterna har en lokal clone behövs ingen WebDAV-server. Dokument
ligger som riktiga filer på disk:

- **Tauri:** klicka "Öppna i Finder/Explorer" → `shell.open(matterFolderPath)`.
  Användaren redigerar i Word, sparar → fs-watcher fångar → auto-commit.
- **Web (Chromium):** File System Access API ger samma upplevelse efter
  en engångsdialog.
- **Web (Safari/iOS):** OPFS, share-sheet för utbyte med Pages/Word.

Skript, CLI, kommandorad — allt som ändrar filer i clonen fångas av samma
`onFileChanged`-handler.

### 3.10 Externa integrationer

- **Outlook-add-in** pratar med lokal AVA på localhost (Tauri serverar :3000).
  Add-inet kallar `/api/mail/received` → klienten commitar → andra klienter
  syncar.
- **Fortnox** pollas från lokal app (period 30 min). Inga webhooks-mottagare
  på servern eftersom där inte finns någon.

### 3.11 Bandbredd och prestanda

Räkneexempel för byrå om 10 användare:

| Mått | Värde |
|---|---|
| Initial partial clone | ~5–10 s |
| Daglig fetch | ~100–300 ms |
| Commits per år (debouncade) | ~50k–100k |
| Klient-disk (12 mån sparse) | ~5–25 GB |
| Server-disk efter 5 år | ~5–50 GB main + LFS |
| Server-bandbredd / dag / byrå | ~50–500 MB |

Server: nightly `git gc --auto`, årlig `git gc --aggressive`. En enkel
Hetzner CX21 räcker (eller, om "ingen månadsavgift" är hårt krav, en
Synology-NAS på byråns kontor).

---

## 4. Server-läget (tjock server)

### 4.1 Designprincip

> **"En central Next.js-server äger datat. Klienter är webbläsare som pratar
> tRPC. Real-time via WebSocket. Skalning vertikalt eller horisontellt.
> Multi-tenant via `organizationId`."**

Detta är **i princip** dagens AVA-kod, fast med event-log och regelmotor som
nya tillägg.

### 4.2 Stack

```
┌─ Klient: bara browser ─────────────────────────────────┐
│  Next.js (samma kod som local-first; renderas via SSR) │
│  Inget lokalt state utöver UI-cache (TanStack Query)   │
└────────────────────────────────────────────────────────┘
                  │ HTTPS (tRPC + SSE)
                  ▼
┌─ Server: en docker-compose ────────────────────────────┐
│  Next.js + tRPC + Prisma                                │
│  PostgreSQL 16                                          │
│  Meilisearch                                            │
│  Apache Tika                                            │
│  Ollama (eller annan LLM-backend)                       │
│  Reverse proxy (Caddy eller nginx)                      │
│                                                         │
│  Rule-executor: en process. Inga claims behövs.         │
│  Event-log: tabell `events`. SSE-broadcast till klienter│
└────────────────────────────────────────────────────────┘
```

### 4.3 Vad som skiljer från local-first

| Aspekt | Local-first | Server |
|---|---|---|
| Datalager | SQLite + git JSON | PostgreSQL |
| Sync | git polling + claims | SSE pub-sub |
| Rule-executor | N klienter, claim-race | 1 server-process |
| Auth | SSH-keys / passkeys | NextAuth + Entra ID eller lokala konton |
| Multi-tenant | 1 repo per byrå | `organizationId` per rad |
| Real-time-lag | ~15 s | ~100 ms |
| Filsystem-mount | Klientens lokala clone | WebDAV-server (befintlig) |
| Lokal Tika/LLM | I klienten | På servern |

### 4.4 Anpassningar från nuvarande kod

Mestadels additiva — ingenting tas bort:

1. **Event-log införs** parallellt med Prisma-writes. tRPC-routrar anropar
   `emitEvent()` vid varje mutation. Initialt: bara dubbel-skrivning. Senare:
   regelmotorn kan ta över specifika flöden.
2. **Regelmotor installeras** som en konsument av event-strömmen. Initialt med
   bara 3–4 regler som migrerats från hardcoded logik (`cron/send-payment-reminders`,
   `analyzeDocument`).
3. **Catch-all HTTP-route** för dynamiska regel-endpoints (`/api/r/[...path]`).
4. **SSE-endpoint** för klienter som vill ha real-time-uppdateringar.
5. **WebDAV-servern stannar** — eftersom klienterna inte har lokal clone.

### 4.5 När detta läge passar

- En IT-leverantör driftar för många byråer
- Byrån vill ha real-time samarbete utan installation
- Byrån är OK med att data lever på leverantörens infrastruktur
  (med ordentliga DPA / databehandlaravtal)
- Mobil web-access utan VPN

---

## 5. Vad som delas i koden

```
src/
├── app/                       100% delat. Next-pages, components, layouts.
├── components/                100% delat.
├── lib/                       100% delat. Domain-helpers, formatters, validators.
│
├── server/
│   ├── routers/               ~95% delat. Samma tRPC-routrar i båda lägen.
│   │                          Skillnad: skriver mot DataStore-interfacet.
│   ├── events/                100% delat. emit, replay, scheduler.
│   ├── rules/                 100% delat. load, match, execute, steps/.
│   ├── data-store/            ← NY abstraktion
│   │   ├── DataStore.ts       interface
│   │   ├── PostgresStore.ts   server-läget
│   │   ├── LocalGitStore.ts   local-first-läget
│   │   └── index.ts           env-flaggad val
│   ├── sync/
│   │   ├── git-sync.ts        local-first
│   │   └── sse-sync.ts        server
│   └── auth/
│       ├── ssh-keys.ts        local-first
│       ├── passkeys.ts        local-first (web)
│       └── nextauth.ts        server
│
└── (scripts/, prisma/, test/) ~90% delat
```

Storleksuppskattning: ~5–10 % av kodbasen är läges-specifik. Resten är
återanvänt.

---

## 6. Kontrakt: `DataStore`-interfacet

Den enda riktiga abstraktionen som krävs för att stödja båda lägen:

```ts
interface DataStore {
  // CRUD
  matters: MatterRepo;
  contacts: ContactRepo;
  documents: DocumentRepo;
  // ... etc, en per entity

  // Event-log
  emitEvent(event: Omit<AvaEvent, "id" | "ts">): Promise<AvaEvent>;
  readEvents(filter: EventFilter): AsyncIterable<AvaEvent>;

  // Claims (no-op i server-läget, git-baserade i local-first)
  tryClaim?(claimId: string, ttlSec: number): Promise<boolean>;

  // Sync-hook
  onChange(handler: (event: AvaEvent) => void): Disposable;
}
```

`PostgresStore` implementerar mot Prisma. `LocalGitStore` implementerar mot
SQLite + filsystems-projektion + git-commits. tRPC-routrarna talar bara mot
interfacet.

---

## 7. Migrationsplan från nuvarande kod

### 7.1 Fas 0 — Förberedelse (vad vi har idag)

- ✅ Färdig: Next + tRPC + Prisma + Postgres + WebDAV
- ✅ Färdig: testtäckning ~84 %
- ✅ Färdig: `yarn test:all` kör hela pipelinen

### 7.2 Fas 1 — Event-log och regelmotor (server-läget först)

**Status: ✅ KLAR per 2026-05-18.** Fundamentet är på plats; nuvarande
server fungerar likadant utåt sett, men internt går alla mutations genom
event-log och regelmotor är aktiverbar för 8 startregler.

Levererat:

- ✅ Event-schema + log-writer + UUID v7 (`src/server/events/`)
- ✅ `IDataStore`-interface + `PostgresEventLog` + tRPC-context-integration
- ✅ `emitEvent`-helpers i 4 routrar: matter, contact, timeEntry, invoice
- ✅ Regel-schema (3 trigger-typer + alla 9 step-typer)
- ✅ Templating med dot-path + filters (upper/lower/date/json)
- ✅ Regel-executor (if/for-each/http.respond, kausalkedjor via causedBy)
- ✅ JsonLogic-predikat för event-trigger-filtrering
- ✅ HTTP-trigger catch-all på `/api/r/[...path]` med 3 auth-lägen
- ✅ Scheduler med cron-parser + idempotens-keys (`schedule:<rule>@<iso>`)
- ✅ `/api/cron/scheduler-tick` driver för extern cron
- ✅ Live-handlers: `email.send` via `services/email.ts`, `llm.extract`
  fire-and-forget mot `analyzeDocument`, `matter.update` via Prisma
- ✅ Email-mall-registry (`generic`, `payment-reminder`, `payment-overdue`)
- ✅ 8 startregler i `src/server/rules/starter-rules.ts` (alla disabled)
- ✅ Seed-script + debug-CLI (`yarn seed:rules`, `yarn ava`)
- ✅ End-to-end-tester för regel-kedjan
- ✅ Spike: claim-race över git push-CAS (validerar local-first-modellen)

Resultat: 855 tester gröna (+82 från fas-1-start), 0 typcheck-fel.

Begränsningar / kvarstår till senare faser:
- Fas 1.5: replay-CLI är begränsad — saknar event-causation-graph-vy
- Yjs-CRDT-fält är inte implementerade än (Fas 3-jobb).

### 7.2.1 Fas 1.5 — Migration av hardcoded business-logic till regler

**Status: ✅ KLAR per 2026-05-18.** Existerande hardcoded flows kör nu
parallellt med regelmotor-versioner.

Levererat:

- ✅ Nya event-typer: `payment.due`, `payment.overdue`,
  `system.payment_scan_requested`, `system.payment_scan_completed`.
- ✅ `src/server/services/payment-scan.ts` — komplex SQL bor kvar i kod,
  men resultatet emittas som events istället för att skicka mail direkt.
- ✅ `src/server/services/payment-scan-listener.ts` — domän-listener som
  lyssnar på `system.payment_scan_requested` och kör scannen.
- ✅ `src/server/rules/event-executor.ts` — glue som kopplar event-loggen
  till regelmotorn så event-triggrade regler kör automatiskt vid emit().
- ✅ Listeners attachade i tRPC-context, scheduler-tick och upload-route.
- ✅ Startregler uppdaterade:
  - `_org/daily-payment-scan` — schedule, emittar `system.payment_scan_requested`
  - `_org/send-payment-due-mail` — event, skickar via `payment-reminder`-mall
  - `_org/send-payment-overdue-mail` — event, skickar via `payment-overdue`-mall
  - `_org/auto-analyze-on-upload` — event, kör llm.extract på alla uppladdningar
- ✅ `upload-route.ts` emittar `document.uploaded` istället för direktanrop
  till `analyzeDocument` — regeln triggar via `llm.extract`-stepet.
- ✅ `cron/send-payment-reminders/route.ts` markerad `@deprecated` med pekare
  till nya flödet. Filen finns kvar för bakåtkompatibilitet under övergång.

Resultat: 865 tester gröna (+10), 0 typcheck-fel.

Migration-path för en byrå:
1. `yarn seed:rules --org <id>` (en gång per byrå)
2. `yarn ava rules enable --org <id> --id _org/daily-payment-scan`
3. `yarn ava rules enable --org <id> --id _org/send-payment-due-mail`
4. `yarn ava rules enable --org <id> --id _org/send-payment-overdue-mail`
5. `yarn ava rules enable --org <id> --id _org/auto-analyze-on-upload`
6. Punkter:a `/api/cron/send-payment-reminders` från extern cron och
   peka istället på `/api/cron/scheduler-tick`

### 7.3 Fas 2 — `DataStore`-abstraktion

**Status: ✅ KLAR per 2026-05-18.**

Levererat:

- ✅ `IDataStore`-interfacet utvidgat med 15 typade Prisma-delegate-properties
  (matters, contacts, documents, invoices, timeEntries, expenses, users, ...)
  + `raw`-escape-hatch för `$transaction`/`$queryRaw`.
- ✅ `PostgresStore` implementerar interfacet genom att exponera Prisma's
  delegates direkt — zero runtime-cost wrapper.
- ✅ Alla 14 tRPC-routrar migrerade: `ctx.prisma.X.method()` →
  `ctx.dataStore.<plural>.method()`. Helpers i `routers/document/shared.ts`
  och matter-routerns `assertMatterInOrg` också uppdaterade.
- ✅ Test-helper `dataStoreFromMockPrisma()` så att mocks från befintliga
  tester återanvänds — varje router-test ger ctx både `prisma: mockPrisma`
  (för bakåtkompatibilitet) och `dataStore: dataStoreFromMockPrisma(...)`.
- ✅ Zero regressioner: 855 tester gröna, 0 typcheck-fel.

Designvalet att exponera Prisma-delegates direkt (istället för att handskriva
15 stycken `IMatterRepo`/`IContactRepo`-interfaces) är dokumenterat i
`src/server/data-store/IDataStore.ts`. Kostnaden: routrarna binds vid Prisma's
typer. Eftersom Prisma är vårt ORM även i local-first-läget (samma client
mot SQLite) är detta ingen läckande abstraktion utan ett medvetet val.

För Fas 3:s `LocalGitStore` betyder detta att vi använder samma Prisma-client
mot SQLite + lägger till `$extends`-middleware för git-commit-on-write. Inga
routrar behöver röras igen.

### 7.4 Fas 3 — Local-first-implementation

**Status: 🟡 KERNEL KLAR per 2026-05-18.** De abstraktioner och kärn-
implementationer som driver hela local-first-läget är på plats. Vad som
återstår är Tauri-bundling, real isomorphic-git-bindning, Yjs-CRDT-fält,
hydrate-on-pull och 15s-poll-loopen.

Kernel-leverans (`src/server/local-first/`):

| Komponent | Vad |
|---|---|
| `IFileSystem` + `InMemoryFileSystem` | DI-vänlig fs-abstraktion |
| `IGitOps` + `InMemoryGitOps` | Git-operationer som test-mockable interface |
| `IProjection<T>` + `JsonProjection<T>` | SOLID-baserat projektions-mönster |
| `MatterProjection` | Per-entity-file till `matters/active/<id>.json` eller `matters/archive/<år>/` |
| `EventLogProjection` | JSONL-append till `events/<år>/<mm>/<dd>.jsonl` |
| `ClaimsProjection` | JSONL-append till `claims/<år>/<mm>/<dd>.jsonl` |
| `time-bucket.ts` | DRY-helper för dagbaserade JSONL-paths |
| `FilesystemEventLog` | `IEventLog`-impl mot fs (Liskov-substituerbar med `PostgresEventLog`) |
| `FilesystemClaimStore` | `IClaimStore`-impl med CAS via push, retry, stale-failover |
| `LocalGitStore` | `IDataStore`-impl som komponerar allt — full Liskov-kompabilitet med `PostgresStore` |

TDD: alla 9 komponenter fick tester skrivna FÖRE implementation; 62 nya
testfall (totalt 917 gröna, 0 typecheck-fel).

SOLID-status:
- **S** — varje klass har en uppgift (projektion projicerar, ops gör git, claim-store claimar)
- **O** — ny entitet = ny `JsonProjection`-subklass, ingen ändring av kernel
- **L** — `LocalGitStore` är substituerbar med `PostgresStore` överallt
- **I** — `IFileSystem` / `IGitOps` / `IProjection` är små fokuserade interfaces
- **D** — kernel-koden beror på interfaces; tester injicerar in-memory-impl

Återstår innan local-first kan dogfooda:

1. ✅ **`IGitOps`-impl mot riktiga git** — KLAR per 2026-05-18. Pragmatiskt
   val: `NodeGitOps` via `child_process` spawning av system-`git` istället
   för `isomorphic-git`. Skäl: hanterar SSH-auth, file://, HTTPS-creds
   out-of-the-box. `isomorphic-git`-paketet stannar installerat för Fas 4
   (web-variant) där subprocess inte är ett alternativ.
2. ✅ **`IFileSystem`-impl mot disk** — KLAR per 2026-05-18.
   `NodeFileSystem` mot `fs/promises` med path-traversal-skydd och
   tmpdir-baserade tester.
3. ✅ **Projektion-paradigm** — KLAR per 2026-05-18.
   - `ProjectionRegistry` — entity ↔ projektion ↔ path-prefix
   - `ProjectionWriter` — write-through: Prisma-write → JSON-fil
   - `ProjectionHydrator` — hydrate: JSON-fil → callback (callern uppdaterar SQLite)
   - Default-registry: matter, contact, user
   - Round-trip-tester bevisar inversion
4. **Bind ProjectionWriter till tRPC mutations + Prisma SQLite-provider**
   (~3 dagar) — varje router-write triggar `writer.project(entity, data)`.
   Schema-config byter provider till SQLite för local-first-läget.
5. **15s-poll-loop med hydrate** (~3 dagar) — bakgrundsprocess som
   `fetch` → diff:ar ändrade paths → `hydrator.hydrateChanges()` →
   SQLite-upsert via Prisma → notifiera tRPC-klienten via SSE/Tauri-event
6. **Yjs-CRDT på fri-text-fält** (~5 dagar) — matter.notes och task-kommentarer
7. **Tauri-wrapper** (~1 vecka) — bundling + auto-update
8. **Migrationsverktyg Postgres → git** (~1 vecka) — engångsexport

Totalt återstår ~3.5 veckor till en körbar Tauri-app. Projektion-paradigmet
ovan var det riskabla — resten är hantverk på toppen.

### 7.4.0 Tidigare estimat (för referens)

**~7 veckor.** Resultat: en byrå kan välja att köra AVA i local-first-läget.

- Tauri-wrapper (~1 v)
- Prisma → SQLite (~2 d)
- JSON-projektion + isomorphic-git (~2 v)
- Hydrate-on-fetch + 15s-poll (~5 d)
- fs-watcher + auto-commit (~3 d)
- Optimistic-retry-UX (~5 d)
- Yjs på anteckningsfält (~3 d)
- Claim-mekanism + stale-failover (~5 d)
- `authorized_keys`-from-git hook (~1 d)
- `git-lfs-transfer`-setup + docs (~1 d)
- Outlook addin pratar lokalt (~1 v)
- Fortnox-polling i lokal app (~3 d)
- Migration-verktyg (Postgres → git) (~1 v)
- Tester + dokumentation (~1 v)

### 7.5 Fas 4 — Pure web-variant

**~5 veckor extra ovanpå Tauri.** Resultat: en byrå kan välja att köra
local-first i bara browser (inkl. iPad).

- SQLite WASM (sql.js eller wa-sqlite, OPFS-persistent) (~1 v)
- isomorphic-git över HTTPS (~3 d)
- PDF.js ersätter Tika (~4 d)
- Sök via FTS5 eller minisearch i WASM (~1 v)
- WebAuthn/passkeys-auth (~1 v)
- Responsiv UI-poliering (~1 v)
- nginx + git-CGI server-setup + docs (~3 d)
- WebLLM opt-in (valfritt, ~4 d)

### 7.6 Totala tider

| Fas | Tid | Kumulativt |
|---|---|---|
| 0 — nuvarande state | — | färdigt |
| 1 — event-log + regler | 5 v | 5 v |
| 2 — DataStore-abstraktion | 2 v | 7 v |
| 3 — Local-first Tauri | 7 v | 14 v |
| 4 — Pure web | 5 v | 19 v |

~5 månader för båda lägen, en utvecklare full-time.

---

## 8. Öppna frågor

Beslut som ännu inte är låsta:

1. **Yjs-lager för fri-text-fält.** Vi har sagt att Yjs används för matter-anteckningar
   och kommentartrådar. Vilka *fler* fält bör vara CRDT? Förslag: titel på matter
   (om två redigerar samma matter samtidigt). Behöver inventeras.

2. **Step-typer som saknas.** Listan i §2.2 är ett första skott. Frågor:
   - `calendar.add_event`?
   - `slack.notify`?
   - `s3.put` / `webhook.call`?
   - `prompt.user` (mänsklig-i-loop-task)?

3. **HTTP-trigger auth — `auth: "user"`.** Tolkning: bara regelägaren får
   anropa endpointen? Eller vilken som helst inloggad user i byrån?

4. **Licensval för AVA-koden själv.** AGPL-3, MIT, BSL? Beror på affärsmodell.
   Inte beslutat.

5. **Mobile native app.** Web räcker för v1. När (om?) bygger vi en native
   React Native-app som klonar repot direkt? Avhänger av kundförfrågan.

6. **Self-hosted git-server.** Vi har sagt "bara sshd + git". För byråer som
   *vill* ha web-UI över git-historiken (t.ex. cgit eller gitweb): är det OK
   att lägga till som opt-in? Båda är OSS och kräver bara CGI.

---

## 9. Referensimplementationer och prior art

- **[Ink & Switch — local-first essay](https://www.inkandswitch.com/local-first/)** — kanonisk designdebatt
- **[Fossil SCM](https://fossil-scm.org/)** — SQLite + git-VCS + wiki + tickets i en binär
- **[Logseq](https://logseq.com/)** — git-backat knowledge management
- **[Obsidian + Sync](https://obsidian.md/sync)** — bevis på betalningsvilja för "din data är din"
- **[Actual Budget](https://actualbudget.org/)** — local-first med encrypted sync
- **[Yjs](https://yjs.dev/)** — CRDT-bibliotek
- **[isomorphic-git](https://isomorphic-git.org/)** — git i ren JS, fungerar i browser
- **[Tauri](https://tauri.app/)** — desktop-bundling
- **[JsonLogic](https://jsonlogic.com/)** — predikat-DSL
- **[git-lfs-transfer](https://github.com/charmbracelet/git-lfs-transfer)** — LFS över SSH utan daemon
- **[Tailscale](https://tailscale.com/)** / **[headscale](https://github.com/juanfont/headscale)** — mesh-VPN för mobil-åtkomst till egen Mac

---

## 10. Sammanfattat

| Princip | Local-first | Server |
|---|---|---|
| Datalager | SQLite + git JSON | PostgreSQL |
| Var data bor | Byråns järn | Leverantörens server |
| Server-mjukvara | Bara sshd + git | Full Next + Postgres + Meili + Tika |
| Klient | Tauri eller web | Web |
| Sync | git polling (15s) | SSE (real-time) |
| Konflikter | Eliminerade via 4 lager | Inga (single writer) |
| Mobil | iPad/iPhone via web (egen Tauri via Tailscale) | iPad/iPhone via web direkt |
| Audit | Git history (50+ år) | Tabell + JSONL-export |
| Pris | Inga månadsavgifter | Beror på leverantör |
| Skalning | Per byrå | Vertikal/horisontell server-side |
| Konfliktlösning för användare | Aldrig — auto-merge + Yjs | Inte ett problem |
