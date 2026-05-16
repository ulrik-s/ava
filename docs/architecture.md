# AVA — Arkitektur och regler

Det här dokumentet beskriver hur systemet är uppbyggt **idag** och vilka
konventioner som styr nya ändringar. Läs det innan du lägger till ny
funktionalitet, framför allt **"Regler"**-sektionerna — de är avgörande
för att tenant-isoleringen och pengarräkningen ska fortsätta stämma.

> **Framtida målbild:** se [`architecture-future.md`](./architecture-future.md)
> som beskriver den dual-mode-arkitektur vi enats om — local-first med tunn
> SSH-server *eller* tjock server-deployment, båda från samma kodbas. Det
> dokumentet är **planen**, inte vad som körs idag.

AVA är ett svenskt CRM för advokatbyråer: kontakter, ärenden, dokument
(med AI-analys), tidregistrering, utlägg, fakturering (inklusive
avbetalningsplaner och acconto), mallbaserad dokumentgenerering,
jävskontroll och rapporter. Språk i både UI och kod-kommentarer är
svenska; enum-värden är engelska (Prisma-konvention).

---

## 1. Teknisk stack

| Lager           | Teknik                                                       |
|-----------------|--------------------------------------------------------------|
| Frontend        | Next.js 16 (App Router), React 19, Tailwind CSS v4, TypeScript |
| API             | tRPC 11 (via `/api/trpc`), Zod 4 för input-validering        |
| ORM             | Prisma 7 mot PostgreSQL 16                                   |
| Auth            | NextAuth 4 med Credentials + Azure AD (Entra ID)             |
| Sök             | Meilisearch v1.6 (dokument-innehåll)                         |
| Textextraktion  | Apache Tika                                                  |
| LLM             | Docker Model Runner (`ai/gemma4`), OpenAI-kompatibel         |
| E-post          | Nodemailer mot Office 365 SMTP                               |
| PDF/DOCX        | Puppeteer + `html-to-docx` + Handlebars                      |
| Excel           | ExcelJS                                                      |
| Tester          | Vitest                                                       |
| Runtime         | Docker Compose (Postgres, Meili, Tika, LLM-bootstrap)        |

Det finns en sidotjänst för WebDAV-åtkomst till dokumentarkivet som körs
via `tsx watch scripts/webdav-server.ts` parallellt med `next dev`.

---

## 2. Filstruktur

```
src/
  app/                      Next.js App Router
    api/                    Route Handlers (REST): auth, trpc, cron,
                            reports/excel, templates/generate, documents,
                            events, organization
    (sidor)/                Klient-sidor: contacts, matters, invoices,
                            reports, templates, settings, time, users,
                            conflicts, search, login
    layout.tsx              Rot-layout (html/body med h-full, Providers,
                            AuthGuard)
    globals.css             Tailwind v4 entry
  components/               Delade komponenter (sidebar, auth-guard,
                            invoices-section, template-editor, ...)
  lib/                      Ren logik + klient-sidig tRPC-factory
    invoice-calc.ts         Beräkningar (öre)
    template-context.ts     Handlebars-kontext + helpers
    auth.ts                 NextAuth-config
    utils.ts, labels.ts     UI-helpers
  server/
    trpc.ts                 tRPC init, createContext, procedures
    db.ts                   Prisma-singleton
    api-auth.ts             Route Handler-auth för REST-endpoints
    routers/                En router per domän (se nedan)
    services/               Sidoeffekter: email, tika, meilisearch,
                            document-analysis
  generated/                Genererad Prisma-client (gitignored)
  types/                    Delade TS-typer
prisma/
  schema.prisma             Källa för datamodellen
  init.sql                  Postgres-init (extensions etc.)
  migrations/               Prisma-migrationer
scripts/                    Engångs- och operativa skript
  webdav-server.ts          WebDAV-frontend mot storage/
  analyze-unanalyzed.ts     Backfill av LLM-analys
  seed-templates.ts         Seed för standardmallar
storage/                    Runtime-filer (dokument, logos) — gitignored
docs/                       Det här dokumentet + andra guider
```

---

## 3. Tenant-isolering (**regel**)

Varje `Organization` är en hård isolationsgräns. Det här är inte valfritt
— en org får **aldrig** se eller mutera en annan orgs data. Två
mekanismer säkerställer det:

### 3.1 `orgProcedure`

`src/server/trpc.ts` exponerar tre procedures:

- `publicProcedure` — ingen auth. Bara för login-flöden och dev-verktyg.
- `protectedProcedure` — kräver `ctx.user`. Använd när du inte behöver
  `organizationId` direkt (t.ex. `ctx.user.id` räcker).
- `orgProcedure` — samma som `protectedProcedure` plus `ctx.orgId`
  lagt i kontexten. **Standardval** för allt som rör org-scopad data.

Mönster:

```ts
list: orgProcedure
  .input(z.object({ matterId: z.string().optional() }))
  .query(({ ctx, input }) =>
    ctx.prisma.invoice.findMany({
      where: {
        matter: { organizationId: ctx.orgId },
        ...(input.matterId ? { matterId: input.matterId } : {}),
      },
    }),
  );
```

Notera att filtret går via `matter.organizationId` (join-filter). Det
betyder att en användare inte kan räkna upp fakturor i en annan org
genom att gissa id:n.

### 3.2 `requireOrgOwned`

När du hämtar *en* rad via id:

```ts
const doc = await requireOrgOwned(
  () => ctx.prisma.document.findUnique({
    where: { id },
    include: { matter: true },
  }),
  ctx.orgId,
  (d) => d.matter.organizationId,
);
```

Kastar `NOT_FOUND` både när raden saknas och när den tillhör fel org.
**Använd alltid `NOT_FOUND`, inte `FORBIDDEN`**, för att inte läcka
existens över org-gränser.

### 3.3 Cross-org-tester

Alla mutations ska ha minst ett test som försöker agera på en rad i
annan org och förväntar `NOT_FOUND`. Se
`src/server/routers/invoice.test.ts` för mönstret (`makeCaller("org-a")`
vs "org-b").

---

## 4. Datamodell (översikt)

Hierarkin i schema.prisma, från topp till botten:

```
Organization ── owns ──► Users, Contacts, Matters, DocumentTemplates, Offices
                │
                └── azureTenantId (unique)   ← single-tenant O365

Matter ── MatterContact ──► Contact       (many-to-many + roll)
       ├── DocumentFolder (träd)
       │      └── Document ── AI-fält (title, documentType, summary)
       │                 └── DocumentAnalysisSuggestion / MatterEventSuggestion
       ├── Email
       ├── TimeEntry   (minuter × timpris → öre)
       ├── Expense     (öre)
       └── Invoice
             ├── type:   STANDARD | ACCONTO | FINAL
             ├── status: DRAFT | SENT | PAID | CANCELLED | BAD_DEBT
             │         | INSTALLMENT_PLAN
             ├── timeEntries/expenses (1-N via invoiceId)
             ├── PaymentPlan 1:1  → PaymentPlanReminder (unique per
             │                                            månad+typ)
             ├── Payment N:1
             └── InvoiceAccontoDeduction  (FINAL ← ACCONTO, unique)
```

**Regler för schemat**

- Alla pengabelopp lagras som `Int` i öre. Aldrig Decimal/Float. Se §5.
- `Organization.id` hör med i WHERE-klausulen (direkt eller via join)
  för **varje** query. Grep efter `organizationId` för att sanity-
  checka nya routers.
- `@map("snake_case")` används för kolumnnamn, modellnamn är PascalCase.
  Prisma-modellen är källan — tabellnamn följer med.
- `onDelete: Cascade` sätts bara där det är semantiskt korrekt (t.ex.
  DocumentFolder → Matter). Payments cascade:ar på Invoice; acconto-
  avdrag cascade:ar bara från FINAL-sidan så att en acconto-faktura inte
  försvinner om en FINAL raderas.

---

## 5. Pengar och enheter (**regel**)

### 5.1 Öre för allt lagrat

| Modell           | Fält          | Enhet                                 |
|------------------|---------------|---------------------------------------|
| `Invoice`        | `amount`      | öre (för FINAL: brutto före avdrag)   |
| `Expense`        | `amount`      | öre                                   |
| `Payment`        | `amount`      | öre                                   |
| `PaymentPlan`    | `monthlyAmount` | öre                                 |
| `User`           | `mileageRate` | öre/km                                |

### 5.2 Kronor-per-timme-undantaget

`User.hourlyRate` och `TimeEntry.hourlyRate` är **kronor per timme**,
inte öre. Detta är bevarat från tidigare systemversion. Konvertering:

```ts
const ore = Math.round((minutes / 60) * hourlyRate * 100);
```

Multiplikationen görs alltid i heltal — avrunda med `Math.round` sist
för att slippa flyttalsfel. `invoice-calc.ts` har de enda godkända
implementationerna (`computeFinalInvoiceBreakdown`, `isPaymentPlanSettled`)
— duplicera inte matten i fler filer.

### 5.3 Formatering för UI

- `formatCurrency(ore)` i `src/lib/utils.ts` → `"12 345,00 kr"`.
- `formatMinutes(m)` → `"2,5 tim"` / `"1 tim 30 min"`.
- `formatAmount(ore)` i `template-context.ts` → för Handlebars-mallar.

Använd alltid befintlig helper, uppfinn inte en egen `toFixed(2)`.

---

## 6. tRPC-konventioner

- En router per domän under `src/server/routers/`, exponerad via
  `_app.ts`. Namnet är substantiv i singular (`invoice`, `matter`, …).
- Input valideras med Zod. Alla fält som är valfria markeras
  `.optional()`, aldrig `.nullable()` (null är bara för DB-kolumner).
- Mutations som rör flera rader körs i `ctx.prisma.$transaction(async
  (tx) => …)`. Se `invoice.createFinal` och `invoice.recordPayment`.
- Returnera hela det uppdaterade objektet (eller det beräknade
  resultatet, som `{ invoice, breakdown }`) istället för `{ ok: true }`
  där det är meningsfullt. Klienten använder `trpc.useUtils().X.invalidate()`
  för cache.
- Felmeddelanden är svenska och riktade till slutanvändaren ("Några
  tidsposter är redan fakturerade eller tillhör annat ärende.").

### Klient-typning

Nya komponenter som tar tRPC-data som prop använder `inferRouterOutputs`:

```ts
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
type Report = NonNullable<inferRouterOutputs<AppRouter>["reports"]["perLawyer"]>;
```

Undvik att härleda typer från `useQuery()`-returen — den har `{}` som
bas och ger konstiga fel.

---

## 7. Auth

Tre inloggningsvägar, i prioritetsordning:

1. **Azure AD / O365** (`NextAuth` + `azure-ad`-provider). Aktiv när
   `AZURE_AD_TENANT_ID/CLIENT_ID/CLIENT_SECRET` är satta. Mappar
   `id_token.oid` → `User.azureOid`, kontrollerar `tid` mot
   `Organization.azureTenantId`. Auto-provisionering via
   `lib/azure-provisioning.ts`.
2. **Credentials** (bcrypt `passwordHash`). För byråer som inte kör O365
   eller för service-konton.
3. **Dev-fallback** i `createContext()` — bara om `NODE_ENV=development`
   eller `DEV_USER=true`. Skapar/tar `dev@example.com` i "Dev
   Advokatbyrå". **Aktiveras aldrig i produktion**.

Session-strategin är JWT, session-objektet bär `id`, `email`, `name`,
`role`, `organizationId`. Läses i tRPC-kontexten.

### Route Handlers som inte är tRPC

REST-endpoints under `src/app/api/**/route.ts` har ingen auto-auth.
Använd `src/server/api-auth.ts` för att återanvända samma session-logik,
eller Bearer-token (t.ex. cron, se §11).

---

## 8. Fakturering (**regler**)

### 8.1 Tre fakturatyper

- `STANDARD` — vanlig löpande faktura (oanvänd av den nya UI:n men
  finns i schemat).
- `ACCONTO` — förskott. Advokaten anger ett belopp; ingen koppling till
  time entries eller expenses. Status går `DRAFT → SENT → PAID`.
- `FINAL` — slutfaktura. Byggs från time entries + expenses som ännu
  inte är knutna till en faktura (`invoiceId = null`). Noll eller flera
  `ACCONTO`-fakturor dras av via `InvoiceAccontoDeduction`.
  `Invoice.amount` på FINAL är **brutto före avdrag**.

### 8.2 Idempotens och race-skydd

- `createFinal` kör allt i `$transaction`: validera entries/expenses/
  accontos, skapa invoice, koppla entries (sätter deras `invoiceId`),
  koppla accontoDeductions. Om något steg kastar så återställer Postgres
  transaktionen.
- En `ACCONTO` kan dras av på **högst en** FINAL. Säkerställs av unique
  `(finalInvoiceId, accontoInvoiceId)` + explicit filter
  `deductedOnFinals: { none: {} }` när acconton väljs ut.
- En `Invoice` har **högst en** `PaymentPlan` (unique `invoiceId`).

### 8.3 Avbetalningsplan

- Skapas bara på fakturor med `status = SENT`. Status flippar då till
  `INSTALLMENT_PLAN`. Att avbryta planen återställer till `SENT`.
- `recordPayment` summerar alla `Payment.amount` och, när summan ≥
  `Invoice.amount`, sätter `Invoice.status = PAID` och
  `PaymentPlan.status = COMPLETED`.
- Månadsmail via cron (§11) är idempotenta: unik `(planId, dueMonth,
  type)` i `PaymentPlanReminder`. Dubbelkör av cron skickar inte två
  mail.

### 8.4 Testning

`src/server/routers/invoice.test.ts` täcker alla proceduren på
`invoiceRouter`, inklusive:

- Positive-path för varje mutation
- Zod-validering (negativa belopp, dayOfMonth 29, förbjudna statusar)
- Cross-org (`NOT_FOUND` när orgId inte matchar)
- Invariant-brott (negativ FINAL-netto, dubbel plan)

Mocket mönster:

```ts
const mockPrisma = {
  invoice: { findFirst: vi.fn(), ... },
  $transaction: vi.fn(<T,>(fn: (tx: any) => Promise<T>) => fn(mockPrisma)),
};
```

Ett verkligt `$transaction` körs ju med en egen `tx` — men för tester
räcker det att köra callbacken mot samma mock.

---

## 9. Dokument, AI-analys och mallar

### 9.1 Upload → analys

1. Dokument laddas upp via `documentRouter.create` eller REST-endpoint.
   Fysisk fil hamnar under `storage/documents/{matterId}/{docId}/`.
2. Upload returnerar direkt (dokumentet markeras ej analyserat).
3. Analys körs separat (trigger via worker eller `analyze-unanalyzed.ts`):
   `services/document-analysis.ts` anropar Tika för textextraktion och
   sedan LLM:en för JSON-output med `title`, `documentType`, `summary`,
   föreslagna kontakter (`DocumentAnalysisSuggestion`) och händelser
   (`MatterEventSuggestion`).
4. LLM-anrop har hård **timeout via AbortController** (default 5 min).
   Om den hänger sparas `analysisError` så dokumentet inte fastnar i
   "analyseras"-tillstånd.

### 9.2 Mallar

- `DocumentTemplate.content` är Handlebars-HTML.
- `template-context.ts` bygger ett kontextobjekt per ärende (matter,
  organization, kontakter roll-kategoriserade, time entries, expenses,
  today, generatedBy, `logoBase64`).
- Generering sker via `POST /api/templates/generate` med
  `{ templateId, matterId, format: "pdf" | "docx" }`. PDF via
  Puppeteer med header/footer från org-inställningar; DOCX via
  `html-to-docx` med `footerType: "first"`.
- Genererade dokument sparas automatiskt som `Document`-rader i
  ärendets mapp.

### 9.3 Logo + sidfot (org-inställningar)

`Organization.logoPath` pekar på fil under `storage/logos/{orgId}/`.
Header visas på alla sidor; footer visas på första sidan (DOCX) eller
alla sidor (PDF). Konfigureras via `/settings`.

---

## 10. Rapporter

`reports.perLawyer({ from, to, userId })` är den enda rapport-procedure
som behövs idag. Returnerar allt för sidan `/reports` i en query:

- `matters` — ärenden advokaten jobbat i under perioden (aggregerat
  per matterId: tid, deb. tid, arbetsvärde, utlägg)
- `weeklyRows` — ISO-veckor som överlappar `[from, to]` med tid +
  arbetsvärde
- `unbilled` — rader där `invoiceId = null` och `billable = true` för
  advokaten inom perioden (per matter + totalsumma)
- `totals` — summering över ärenden

UI:t (`src/app/reports/page.tsx`) kör en fast topprad (period + advokat-
dropdown + Excel-export) och en scrollbar panel med fyra kort. Excel-
exporten (`/api/reports/excel`) speglar data i tre blad: Ärenden,
Timdebitering per vecka, Upparb. ej fakt.

**ISO-vecka** (`isoWeek`, `weeksInRange`) räknas i UTC — använd inte
`Date#getDay()` utan suffixet `getUTCDay()`. Varje rapport-procedure
har egen kopia av hjälparna eftersom de är små och lätta att hålla
synkade; om logiken blir mer komplex, flytta ut till `src/lib/iso-week.ts`.

---

## 11. Cron och bakgrundsjobb

Externt cron-system (t.ex. Vercel Cron, en systemd-timer, Azure
Logic App) anropar:

```
POST /api/cron/send-payment-reminders
Authorization: Bearer ${CRON_SECRET}
```

Endpoint-arkitektur:

1. Validera bearer-token mot `CRON_SECRET`.
2. Iterera aktiva `PaymentPlan`.
3. För varje plan: avgör om det är `dayOfMonth` (skicka DUE) eller
   `dayOfMonth + 10` utan inkommen betalning (skicka OVERDUE).
4. Skapa rad i `PaymentPlanReminder` (`(planId, dueMonth, type)`
   unique). Om skrivningen misslyckas → mailet är redan skickat →
   hoppa över.
5. Skicka via `services/email.ts` (Nodemailer → Office 365 SMTP,
   STARTTLS port 587, lazy+cachad transport).

Alla nya cron-endpoints ska följa samma Bearer-pattern och skriva till
en unique-konstraint för idempotens.

---

## 12. Infrastruktur

### 12.1 docker-compose.yml

Startar: `postgres` (5432), `meilisearch` (7700), `tika` (9998) och en
`llm-bootstrap`-service som refererar top-level `models: llm:
ai/gemma4`. Bootstrap-servicen gör bara `echo` — syftet är att
**tvinga** Docker Model Runner att pulla modellen vid `docker compose
up`; en top-level `models:`-deklaration utan en refererande service
triggar inte pull.

### 12.2 LLM-åtkomst

Docker Model Runner exponerar en OpenAI-kompatibel endpoint host-side
(default `http://localhost:12434/engines`). Modellen körs via vLLM-
backenden (Metal GPU på Mac).

Env-variabler (provider-agnostiska):

```
LLM_BASE_URL=http://localhost:12434/engines
LLM_MODEL=ai/gemma4
LLM_TIMEOUT_MS=300000
```

Bakåtkompat: `LM_STUDIO_URL` / `LM_STUDIO_MODEL` respekteras om de är
satta. **Använd alltid de nya namnen i ny kod.**

### 12.3 Env-checklista

| Variabel                | Syfte                                 |
|-------------------------|---------------------------------------|
| `DATABASE_URL`          | Postgres                              |
| `NEXTAUTH_SECRET`       | NextAuth JWT-signing                  |
| `NEXTAUTH_URL`          | Callback-url                          |
| `AZURE_AD_*`            | O365-login (valfritt)                 |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Avisering                     |
| `CRON_SECRET`           | Bearer för `/api/cron/*`              |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_TIMEOUT_MS` | Docgenering |
| `MEILI_HOST` / `MEILI_KEY` | Dokumentsök                        |
| `TIKA_URL`              | Textextraktion                        |

---

## 13. UI-konventioner

- **Layout**: `AuthGuard` renderar sidebar (`lg:flex`) + `<main>` med
  `overflow-y-auto`. Vid `< lg` finns en `fixed top-0 h-14 z-30`
  hamburgar-rad. `<main>` har `pt-16 sm:pt-16 lg:pt-0` för att inte
  krocka — **skriv inte shorthand `p-N` som ensamt override** eftersom
  det återställer padding-top (varje breakpoint som sätter `p-N`
  behöver en matchande explicit `pt-N`).
- **Scrollande sidor**: hellre flex-col `h-full` på page-roten med en
  `flex-none` topp och en `flex-1 overflow-y-auto min-h-0` för
  innehållet, än `sticky` som kräver fingertoppskänsla kring stacking
  contexts. Se `/reports`.
- **Svenska** i labels och knappar. Siffror är `sv-SE`-formaterade
  (`toLocaleString`, `formatCurrency`). Datum som `toLocaleDateString("sv-SE")`.
- **Färger**: blå primary (`bg-blue-600 text-white`), grå sekundär
  (`border-gray-300 text-gray-700`), gröna/ambra/röd pils för status.
- **Tabeller**: `<thead className="bg-gray-50">`, `divide-y divide-gray-200`,
  `font-mono` för belopp och siffror.

---

## 14. Tester

- `npm test` (watch) eller `npm run test:run` (CI) kör Vitest.
- Fil-konvention: `foo.test.ts` bredvid `foo.ts`, eller under
  `routers/` för integrationstester.
- Ren logik testas direkt (se `invoice-calc.test.ts`). Routers testas
  med mockad Prisma och `router.createCaller(ctx as any)`.
- Alla mutations ska täckas av minst ett positive-path-test, ett
  zod-valideringstest och ett cross-org-test.

---

## 15. Språk- och namnkonventioner

- Kod och filnamn: engelska (camelCase för variabler, PascalCase för
  komponenter/typer, kebab-case för filer).
- Enum-värden: engelska, SCREAMING_SNAKE (`INSTALLMENT_PLAN`,
  `BAD_DEBT`). Översätts i UI via `src/lib/labels.ts`.
- Kommentarer och commit-meddelanden: svenska eller engelska beroende
  på vad som redan dominerar filen. Kommentera **varför**, inte vad.
- Användarvända strängar: alltid svenska.
- Roller (`MatterRole`) använder svenska termer utan svenska tecken
  (`HAUPTMAN` → `KLIENT`, `MOTPARTSOMBUD`, `AKLAGARE`, …) för att
  undvika kodnings-problem i nycklar.

---

## 16. Checklista innan merge

1. `npx tsc --noEmit` rent (undantaget `scripts/webdav-server.ts` om
   det felar på orelaterade rader).
2. `npm run test:run` grönt.
3. Nya routers har `orgProcedure` + cross-org-test.
4. Nya Prisma-fält som bär belopp är `Int` (öre). Timpris är fortsatt
   kronor/h och dokumenterat i kommentaren.
5. Användarvända strängar är svenska.
6. `prisma migrate dev --name <beskrivande-namn>` för schemat. Använd
   `db push --accept-data-loss` bara i lokal dev när migrationshistorik
   divergerat — aldrig i prod.
7. Nya cron-endpoints kräver Bearer + idempotens via unique-constraint.
