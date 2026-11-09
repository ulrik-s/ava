# Från användarens förfrågan till produktion

Användarna rapporterar buggar och föreslår förbättringar direkt i AVA. Tre
schemalagda Claude-loopar bryter ner, granskar och implementerar dem. Allt
går via CI till `main`, som deployas till **staging** automatiskt. Produktion
får en ändring först när Ulrik sätter en `v*`-tagg.

```
 AVA: "Bugg eller förslag"
        │ (servern, token med bara Issues: write)
        ▼
 ulrik-s/ava-feedback  (PRIVAT)        user-request
        │ Ulrik läser och sätter        godkänd          ← enda mänskliga grinden in
        ▼
 Loop 1 nedbrytning  ──►  ulrik-s/ava (PUBLIKT), avidentifierade issues
        │                               agent-task + att-granska
        ▼
 Loop 2 granskning   ──►  granskad
        ▼
 Loop 3 implementation ─► PR  agent-pr + att-granska
        ▼
 Loop 2 granskning   ──►  granskad + auto-merge   (eller behöver-ändras → loop 3)
        ▼
 CI (alla krävda kontroller + Agentvakt) ──► main ──► staging.ava-crm.io (inom 5 min)
        ▼
 Ulrik provar på staging, taggar:  git tag vX.Y.Z && git push origin vX.Y.Z
        ▼
 ava-crm.io (inom 5 min) ──► Loop 1 stänger förfrågan: levererad + release:vX.Y.Z
        ▼
 Användaren ser "Levererad i vX.Y.Z" under "Dina förfrågningar"
```

## Varför det ser ut så här

- **Privat intag.** Kodrepot är publikt. Användare skriver klientnamn och
  ärendeuppgifter, och det får aldrig hamna där (advokatsekretess, GDPR).
  Användarnas text stannar i `ava-feedback`. Agenterna skriver egna,
  avidentifierade issues i `ava`.
- **Ulrik godkänner först.** Användartext som styr agenter som skriver kod är
  en väg för prompt injection. Ingen agent rör en förfrågan innan `godkänd`
  är satt av `ulrik-s`.
- **Gränserna är mekaniska.** Promptarna säger vad agenterna inte får göra,
  och **Agentvakten** (`.github/workflows/agent-guard.yml`, krävd kontroll)
  fäller en agent-PR som
  - rör skyddade sökvägar (CI, deploy, auth, agentpromptarna …),
  - innehåller en destruktiv migration,
  - är fler än 10 på ett dygn,
  - eller inte har `granskad`.

  `människa-godkänd` (bara Ulrik) släpper de två första.
- **Additiva migrationer.** En release backas med en äldre tagg, men databasen
  backas inte. Gammal kod måste därför fungera mot det nya schemat.
- **Staging är en riktig server**, inte Pages-demon. Demon saknar server,
  Postgres, migrationer och inloggning, så den visar inte det som brukar gå
  sönder.

## Etiketterna

Definieras i `tooling/agents/labels.json`. Skapas och uppdateras med
`bash tooling/scripts/setup-agent-labels.sh`.

| Repo | Etikett | Sätts av | Betyder |
|---|---|---|---|
| ava-feedback | `user-request` | servern | Ny förfrågan från knappen |
| ava-feedback | `bugg` / `förslag` | servern | Typ |
| ava-feedback | `godkänd` | **Ulrik** | Får brytas ner |
| ava-feedback | `nedbruten` | loop 1 | Issues finns i ava |
| ava-feedback | `levererad`, `release:vX` | loop 1 | Ute i produktion |
| ava | `agent-task` | loop 1 | Implementations-issue |
| ava | `att-granska` | loop 1 / 3 | Väntar på loop 2 |
| ava | `granskad` | loop 2 | Godkänd (issue: får byggas; PR: får mergas) |
| ava | `behöver-ändras` | loop 2 | PR:en går tillbaka till loop 3 |
| ava | `pågår` | loop 3 | Under arbete |
| ava | `agent-pr` | loop 3 | PR från en agent (Agentvakten gäller) |
| båda | `blockerad` | alla | Väntar på Ulrik, och ingen agent rör den |
| ava | `människa-godkänd` | **Ulrik** | Agent-PR får röra skyddade sökvägar/migrationer |

Användaren ser statusen i AVA: *Mottagen → Godkänd → Under arbete →
Levererad i vX* (eller *Avslutad* om issuen stängs utan leverans).

## Uppsättning (en gång)

### 1. Token för knappen

GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*:

- **Repository access:** *Only select repositories* → `ulrik-s/ava-feedback`
- **Permissions:** *Issues: Read and write* (Metadata: read följer med)
- **Expiration:** ett år, med en kalenderpåminnelse.

Lägg in i `/srv/ava/ava-server.env` på produktionsservern:

```bash
AVA_FEEDBACK_GITHUB_TOKEN=github_pat_…
AVA_FEEDBACK_REPO=ulrik-s/ava-feedback
```

Värdena läses vid nästa deploy (nästa tagg). Vill du ha dem direkt:
`cd /srv/ava && set -a && . ./ava-server.env && set +a && docker compose -f tooling/docker/docker-compose.production.yml up -d server-first`.
Knappen "Bugg eller förslag" syns då längst ned i sidomenyn. Utan token
syns den inte.

Staging får **ingen** token. Då hamnar inga testförfrågningar bland de riktiga.

### 2. Etiketterna

```bash
bash tooling/scripts/setup-agent-labels.sh   # ulrik-s/ava-feedback + ulrik-s/ava
```

### 3. Agentvakten som krävd kontroll

Settings → Branches → `main` → *Require status checks* → lägg till **Agentvakt**
(eller via `gh api`, se PR:en som införde den). Utan det kan auto-merge
mergea förbi den.

### 4. Staging

Se [Staging](#staging) nedan.

### 5. Looparna

Tre schemalagda Claude Code-agenter (`/schedule` i Claude Code). Varje
agent behöver tillgång till **båda** repona (`ulrik-s/ava` och
`ulrik-s/ava-feedback`) och `gh`. Prompten är kort och pekar på filen i
repot. Instruktionerna versioneras alltså med koden, och agenterna kan
inte ändra dem (Agentvakten skyddar `tooling/agents/`).

| Loop | Förslag på schema | Prompt |
|---|---|---|
| 1 Nedbrytning + uppföljning | var 2:a timme, 07–19 | `Läs och följ tooling/agents/1-nedbrytning.md i ulrik-s/ava.` |
| 2 Granskning | varje timme, 07–21 | `Läs och följ tooling/agents/2-granskning.md i ulrik-s/ava.` |
| 3 Implementation | varje timme, 08–20 | `Läs och följ tooling/agents/3-implementation.md i ulrik-s/ava.` |

Ett körning utan arbete avslutas efter en rad. Tätare schema ger snabbare
leverans men kostar mer. Börja glest och öka när du ser hur det går.

**Pausa:** stäng av looparna i `/schedule`, eller sätt `blockerad` på en
enskild issue eller PR.

## Staging

`staging.ava-crm.io` är en **egen server**: samma installation som
produktionen, men den följer `main`. Ett eget värdnamn på samma server som
produktionen skulle dela Caddy (port 80/443), Docker-nätverk och
backupkataloger med produktionen. En liten VPS (2 GB RAM räcker för bygget)
håller staging helt isär.

1. **Server + DNS:** en VPS med Docker, och en A-post `staging.ava-crm.io` → dess IP.
2. **Inloggning:** registrera `https://staging.ava-crm.io/oauth2/callback`
   som redirect-URI i IdP:n. Helst en egen klient, så delar staging och
   produktionen inga hemligheter. Lägg en egen `OAUTH2_PROXY_COOKIE_SECRET`.
3. **Installera** enligt [deploy-server-first.md → Installation](./deploy-server-first.md#installation),
   med dessa skillnader i `ava-server.env`:

   ```bash
   AVA_DOMAIN=staging.ava-crm.io
   AVA_DEPLOY_TRACK=main            # följ main, inte taggar
   AVA_ERROR_ENVIRONMENT=staging
   AVA_EMAIL_DISABLED=1             # staging skickar aldrig e-post
   # inga AVA_FEEDBACK_*, inga AVA_FORTNOX_*: inget riktigt utanför staging
   ```

4. **Demodata** i den nya, tomma databasen (efter `db-migrate.ts`, med
   `avarun` från installationsavsnittet):

   ```bash
   AVA_ORG_NAME="AVA Staging" AVA_ADMIN_EMAIL=<din inloggning> AVA_ADMIN_NAME=Ulrik \
     avarun tooling/scripts/seed-selfhosted-local.ts
   avarun tooling/scripts/seed-demo-into-server.ts
   ```

   Det är påhittad data, aldrig en kopia av produktionen.
5. **Första deployen** för hand: `bash tooling/scripts/deploy-prod.sh`. Den
   installerar `ava-deploy.timer`, som sedan deployar varje ny commit på `main`
   inom fem minuter. `curl https://staging.ava-crm.io/readyz` visar
   `"release":"v0.4.0-3-gabc1234"`, alltså senaste taggen plus antal commits.
6. **Backup** behövs inte (demodata). Sätt inte upp nattjobben där.

## Releasa

1. Prova på staging. `readyz` visar exakt vilken commit som kör.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`. Allt som ligger på `main`
   följer med.
3. Hittar du en dålig ändring på staging innan du taggar: `git revert` den
   på `main` (vanlig PR), eller sätt `blockerad` på dess issue och vänta med
   taggen.
4. Rollback i produktion: tagga om en äldre commit som en ny, högre version
   (se deploy-server-first.md → Rollback). Databasen backas inte, och därför
   kräver Agentvakten additiva migrationer.

## Filer

| Vad | Var |
|---|---|
| Knappen + dialogen | `src/components/shell/feedback-button.tsx` |
| Server: router, GitHub-adapter | `src/lib/server/routers/feedback.ts`, `src/lib/server/feedback/` |
| Kontrakt, statusar | `src/lib/shared/feedback.ts` |
| Agentpromptar | `tooling/agents/*.md` |
| Etiketter | `tooling/agents/labels.json`, `tooling/scripts/setup-agent-labels.sh` |
| Agentvakten | `tooling/scripts/agent-guard.ts`, `.github/workflows/agent-guard.yml` |
| Staging-deploy | `tooling/scripts/deploy-latest-tag.sh` (`AVA_DEPLOY_TRACK=main`) |
