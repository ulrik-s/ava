# Från användarens förfrågan till produktion

Användarna rapporterar buggar och föreslår förbättringar direkt i AVA. Fyra
schemalagda Claude-agenter i molnet verifierar, bryter ner, granskar och
implementerar dem. Allt går via CI till `main`, som deployas till **staging**
automatiskt. Produktion får en ändring först när Ulrik sätter en `v*`-tagg.

```
 AVA: "Bugg eller förslag"
        │ (servern, token med bara Issues: write)
        ▼
 ulrik-s/ava-feedback  (PRIVAT)        user-request
        ▼
 Loop 1 verifiering  ──►  rapport + undersökt [+ ej-bekräftad]
        │ Ulrik läser rapporten och sätter  verifierad   ← enda mänskliga grinden in
        ▼
 Loop 2 nedbrytning  ──►  ulrik-s/ava (PUBLIKT), avidentifierade issues
        │                               agent-task + att-granska
        ▼
 Loop 3 granskning   ──►  granskad
        ▼
 Loop 4 implementation ─► PR  agent-pr + att-granska
        ▼
 Loop 3 granskning   ──►  granskad  (eller behöver-ändras → loop 4)
        ▼
 Loop 3 mergar den granskade sha:n när CI (inkl. Agentvakt) är grön ──► main
        ▼
 main ──► staging.ava-crm.io (inom 5 min)
        ▼
 Ulrik provar på staging, taggar:  git tag vX.Y.Z && git push origin vX.Y.Z
        ▼
 ava-crm.io (inom 5 min) ──► Loop 2 stänger förfrågan: levererad + release:vX.Y.Z
        ▼
 Användaren ser "Levererad i vX.Y.Z" under "Dina förfrågningar"
```

## Varför det ser ut så här

- **Privat intag.** Kodrepot är publikt. Användare skriver klientnamn och
  ärendeuppgifter, och det får aldrig hamna där (advokatsekretess, GDPR).
  Användarnas text stannar i `ava-feedback`. Agenterna skriver egna,
  avidentifierade issues i `ava`.
- **Först verifieras det.** Verifieringsagenten försöker återskapa buggen,
  eller kontrollera att förslaget behövs och inte redan finns, och skriver en
  rapport. Den fattar inget beslut. Ulrik bestämmer på rapporten, inte på
  användarens ord.
- **Ulrik godkänner, och agenterna kan inte förfalska det.** Användartext som
  styr agenter som skriver kod är en väg för prompt injection. Molnagenterna
  agerar som Ulriks konto, så en etikett bevisar inget i sig. Därför räknas
  `verifierad` bara om issuens händelselogg visar att den sattes av `ulrik-s`
  **utan** `performed_via_github_app` (alltså inte via Claudes app). Se
  [Kontrollera godkännandet](#kontrollera-godkännandet-en-gång).
- **Gränserna är mekaniska.** Promptarna säger vad agenterna inte får göra,
  och **Agentvakten** (`.github/workflows/agent-guard.yml`, krävd kontroll)
  fäller en agent-PR som
  - rör skyddade sökvägar (CI, deploy, auth, agentpromptarna …),
  - innehåller en destruktiv migration,
  - är fler än 10 på ett dygn,
  - eller inte har `granskad`.

  `människa-godkänd` (bara Ulrik) släpper de två första. Granskningsloopen
  mergar dessutom bara exakt den commit den granskat (`sha` i merge-anropet),
  så en push efter granskningen kan aldrig slinka med.
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
| ava-feedback | `väntar-på-användaren` | loop 1 / Ulrik | En fråga till användaren väntar på svar (i AVA) |
| ava-feedback | `undersökt` | loop 1 | Verifieringsrapporten finns |
| ava-feedback | `ej-bekräftad` | loop 1 | Buggen/behovet kunde inte bekräftas |
| ava-feedback | `verifierad` | **Ulrik** | Sant och värt att bygga — får brytas ner |
| ava-feedback | `nedbruten` | loop 2 | Issues finns i ava |
| ava-feedback | `levererad`, `release:vX` | loop 2 | Ute i produktion |
| ava | `agent-task` | loop 2 | Implementations-issue |
| ava | `att-granska` | loop 2 / 4 | Väntar på loop 3 |
| ava | `granskad` | loop 3 | Godkänd (issue: får byggas; PR: får mergas) |
| ava | `behöver-ändras` | loop 3 | PR:en går tillbaka till loop 4 |
| ava | `pågår` | loop 4 | Under arbete |
| ava | `agent-pr` | loop 4 | PR från en agent (Agentvakten gäller) |
| båda | `blockerad` | alla | Väntar på Ulrik, och ingen agent rör den |
| ava | `människa-godkänd` | **Ulrik** | Agent-PR får röra skyddade sökvägar/migrationer |

Användaren ser statusen i AVA: *Mottagen → Undersökt — väntar på beslut*
(eller *Kunde inte bekräftas*) *→ Verifierad → Under arbete → Levererad i vX*.
Stängs issuen utan leverans visas *Avslutad*.

### Så verifierar du en förfrågan

Läs verifieringsrapporten på issuen i `ava-feedback`, och sätt sedan
etiketten själv, i webbläsaren eller med `gh` på din dator:

```bash
gh issue edit <nr> -R ulrik-s/ava-feedback --add-label verifierad
```

Är rapporten "Ej bekräftad" kan du ändå verifiera, om du vet bättre. Du kan
också fråga användaren, eller stänga issuen (användaren ser då *Avslutad*).

### Dialog med användaren

Användaren läser och svarar i AVA: "Bugg eller förslag" i sidomenyn visar en
tabell över hens förfrågningar, och en **röd prick** (på knappen och på raden)
när något nytt har skrivits till hen. Ett klick öppnar dialogen, där hen kan
svara. Knappen hämtar läget var 5:e minut. "Senast läst" sparas i
användarens inställningar (`feedback.seen`), så pricken försvinner på alla
enheter.

Vad användaren ser styrs av markörer först i kommentaren:

| Kommentar börjar med | Visas för användaren som | Skrivs av |
|---|---|---|
| `<!-- till-anvandaren -->` | **Claude** (via Claudes app) eller **Ulrik** (annars) | verifieringsagenten, eller du |
| `<!-- ava-user-reply:<id> -->` | **Du** (bara för den användaren) | AVA-servern, när användaren svarar |
| allt annat (rapporter, anteckningar) | syns inte | |

Verifieringsagenten frågar användaren när svaret bara finns hos hen, sätter
`väntar-på-användaren` (användaren ser *Väntar på ditt svar*) och fortsätter
när hen har svarat. Högst två frågerundor, och efter 7 dagar utan svar skrivs
rapporten ändå.

**Skriva till användaren själv:**

```bash
printf '%s\n' '<!-- till-anvandaren -->' 'Hej! Gäller det alla fakturor eller bara den från i måndags?' > fraga.md
gh issue comment <nr> -R ulrik-s/ava-feedback --body-file fraga.md
gh issue edit <nr> -R ulrik-s/ava-feedback --add-label väntar-på-användaren
```

Du behöver inte ta bort `undersökt`. När användaren svarar tar
verifieringsagenten issuen vid nästa körning, även om rapporten redan finns.
Den skriver då en ny rapport med svaret inräknat.

**Etiketternas livscykel under verifieringen:**

```
ny förfrågan ─► agenten undersöker
                 ├─ frågor ─► väntar-på-användaren (INTE undersökt)
                 │              │ användaren svarar i AVA
                 │              ▼ nästa körning: tar bort väntar-…, fortsätter
                 │              (högst 3 rundor; 7 dagar utan svar → Ej bekräftad)
                 └─ klart ──► rapport + undersökt [+ ej-bekräftad] ─► du: verifierad
du frågar efter rapporten ─► väntar-på-användaren ─► svar ─► agenten tar bort
                              undersökt och skriver en ny rapport
```

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

Klart sedan 2026-11-09: **Agentvakt** är en krävd kontroll på `main`. GitHub
vägrar därför granskningsloopens merge tills den är grön.

### 4. Staging

Se [Staging](#staging) nedan.

### 5. Looparna i molnet

Fyra **schemalagda molnagenter** (`/schedule` i Claude Code). De körs på
Anthropics servrar, så din dator behöver inte vara igång, och de använder
din Claude-prenumeration (ingen separat kostnad för servern).

Förutsättningar:

- **Claudes GitHub-app** installerad på både `ulrik-s/ava` och
  `ulrik-s/ava-feedback`. Använd appen, inte `/web-setup` (som skickar din
  egen `gh`-token): kontrollen av ditt godkännande bygger på att agenternas
  händelser bär appens märke.
- Varje agent får **båda** repona.
- Nätverk: standard (*Trusted*) räcker. Agenterna når GitHub och
  paketregistren, och verifieringen återskapar buggar i sin egen miljö (demon
  och tester), inte på staging, som kräver inloggning.

Prompten är kort och pekar på filen i repot. Instruktionerna versioneras
alltså med koden, och agenterna kan inte ändra dem (Agentvakten skyddar
`tooling/agents/`).

| Agent | Schema (kortast tillåtna är 1 h) | Prompt |
|---|---|---|
| 1 Verifiering | varje timme, 07–21 | `Läs och följ tooling/agents/1-verifiering.md i ulrik-s/ava.` |
| 2 Nedbrytning + uppföljning | varannan timme, 07–19 | `Läs och följ tooling/agents/2-nedbrytning.md i ulrik-s/ava.` |
| 3 Granskning + merge | varje timme, 07–21 | `Läs och följ tooling/agents/3-granskning.md i ulrik-s/ava.` |
| 4 Implementation | varje timme, 08–20 | `Läs och följ tooling/agents/4-implementation.md i ulrik-s/ava.` |

En körning utan arbete avslutas efter en rad. Tätare schema ger snabbare
leverans men drar mer av prenumerationen. Börja glest och öka när du ser hur
det går.

**Pausa:** stäng av agenterna i `/schedule`, eller sätt `blockerad` på en
enskild issue eller PR.

### Kontrollera godkännandet (en gång)

Agenterna agerar som ditt GitHub-konto. Skillnaden mellan ditt `verifierad`
och en agents är att agentens händelse bär Claudes app i
`performed_via_github_app`. Det är inte dokumenterat, så kontrollera det
efter första körningen. Ta en issue som verifieringsagenten har satt
`undersökt` på:

```bash
gh api "repos/ulrik-s/ava-feedback/issues/<nr>/events" \
  --jq '.[] | select(.event=="labeled") | {label: .label.name, actor: .actor.login, app: .performed_via_github_app.slug}'
```

- `undersökt` ska ha `app` satt (t.ex. `claude`).
- `verifierad` som du satt själv ska ha `app: null`.

**Saknar `undersökt` app-märket** kan grinden inte skilja dig från agenterna.
Stäng då av agenterna och skaffa ett separat GitHub-konto för dem (t.ex.
`ava-agent`, med skrivrätt på båda repona), och koppla Claude-molnet till det
kontot. Byt sedan `ulrik-s`-kontrollen i `0-gemensamma-regler.md` till "inte
`ava-agent`".

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
