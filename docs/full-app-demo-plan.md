# Plan — Full app-browsing i demo-läget

## Mål

Användare som öppnar `https://ulrik-s.github.io/ava/` ska kunna klicka
runt i hela CRM-appen (Ärenden, Kontakter, Fakturor, Tidpost, Rapporter,
Konflikter, Sökning) som om det vore en live-installation. All data
kommer från `DemoDataStore` som backas av `DemoRuntime` (klonat
`ulrik-s/ava-demo` via GH Pages). Skrivoperationer är gråade ut.

## Nuvarande blockerare

`appRouter` (import-tree från `src/server/routers/_app.ts`) drar in
Node-only-paket transitivt:

```
appRouter
  └─ router/document.ts
      └─ services/document-analysis.ts
          └─ pdf-parse, tesseract.js → fs, child_process
  └─ router/invoice.ts
      └─ services/notification-sender.ts
          └─ nodemailer → fs, dns
  └─ trpc.ts
      └─ db.ts
          └─ @prisma/adapter-pg → pg → pg-connection-string, pgpass → fs
```

Browser-bundlern kan inte resolva `fs`/`dns`/`child_process`/etc., så
ett naivt `import { appRouter } from "@/server/routers/_app"` i client
kraschar bygget.

## Strategi: Port-and-Adapter-isolering

Varje service som rör Node-only API:er flyttas bakom ett interface i
`src/server/ports/`. Konkreta implementationer lever i
`src/server/adapters/`. Routrar och andra services beror endast på
interfacet — aldrig på adapter:n direkt.

Kompositionsroten (`createContext` på server, `DemoBootstrap` på
client) wirar konkret implementation. Demo-läget får alltid
no-op-implementationer.

### Ports att skapa

| Port | Använder Node | No-op-demo |
|---|---|---|
| `IEmailSender` | nodemailer | `NoopEmailSender` |
| `IDocumentReader` | pdf-parse | `ThrowingDocumentReader` |
| `IOcrEngine` | tesseract.js | `NoopOcrEngine` |
| `IFileStorage` | fs/promises | `OpfsFileStorage` (demo) |
| `IPdfRenderer` | puppeteer | `NoopPdfRenderer` |
| `IInvoiceSender` | nodemailer + pdf | `NoopInvoiceSender` |
| `IIcsBuilder` | (ren funktion?) | direkt browser-impl |

### Prisma-isolering

`src/server/db.ts` exporterar `prisma`-proxy. Routrar ska INTE
importera den direkt — bara via `IDataStore` på `ctx`. Audit varje
router för direktimporter:

```bash
grep -rln 'from "@/server/db"\|from "../db"' src/server/routers
```

Migrera alla träffar till `ctx.dataStore.<entity>`.

`prisma`-proxy:n behålls för `createContext` på server-sidan men
ingen client-kod ska transitivt nå den.

### NextAuth-shim

`SessionProvider` är client-only och fungerar tekniskt utan backend,
men `useSession()` returnerar `"unauthenticated"`. Vi behöver en
demo-sköld så hooks som läser session får en fake user. Två val:

A. **Demo SessionProvider stub**: en wrapper som mockar `useSession`
   när `NEXT_PUBLIC_DEMO_BUILD=1`.

B. **Replace `useSession` calls med en abstraktion** (`useCurrentUser`)
   som har två impl: NextAuth-backed och DemoUser-backed.

B är renare. Lite mer kod men explicit beroende.

## Faser

### Fas R1 — Audit (2h)

1. Generera komplett import-graf från `_app.ts`:
   ```bash
   yarn depcruise --output-type dot \
     src/server/routers/_app.ts > /tmp/router-graph.dot
   ```
2. Lista alla Node-modul-imports i den grafen.
3. Bygg `out/`-bundle med dummy stubs och iterera tills alla
   "Module not found" är borta. Varje träff → en port.

**Deliverable:** `docs/full-app-demo-audit.md` med port-listan.

### Fas R2 — Skapa ports (4h)

Per service med Node-imports:
1. Definiera interface i `src/server/ports/<Name>.ts`
2. Skapa adapter i `src/server/adapters/<Name>Adapter.ts` med
   nuvarande Node-impl (oförändrad logik, flyttad fil)
3. Skapa `Noop<Name>.ts` i samma mapp för demo-läget
4. Uppdatera service:n så den tar in en `INameSender` (eller får
   den via `ctx`)
5. Uppdatera tester — fortsätt använda fake-impl

**Deliverable:** Alla ports + adapters skapade, tests gröna.

### Fas R3 — Migrera routrar (2h)

1. Sök efter direktimporter av `prisma`/services i routrarna
2. Byt mot `ctx.<port>.<method>(...)` eller `ctx.dataStore.<entity>`
3. Uppdatera `createContext` (`src/server/trpc.ts`) för att wira
   konkreta adapters i server-läge
4. Uppdatera `DemoBootstrap`/demo-context för att wira Noop:s

**Deliverable:** Alla routers kan importeras i browser utan att dra
in Node-paket.

### Fas R4 — Demo-bootstrap + sidor (3h)

1. Återinför `src/client/components/demo-bootstrap.tsx` (designet från
   tidigare attempt). Nu ska `createDemoTrpcLink` fungera eftersom
   appRouter är bundle-bar.
2. Ta bort list-sidor från `STASH_PATHS` i `build-demo.sh`:
   - `contacts`, `matters`, `invoices`, `time`, `reports`,
     `conflicts`, `search`
3. Lämna kvar `[id]`-routes i stash tills generateStaticParams
   adderas.
4. `NEXT_PUBLIC_DEMO_BUILD`-gating i routrarna: t.ex. document-upload
   visar tooltip "Inte tillgängligt i demo" istället för att kasta.

**Deliverable:** Alla list-sidor renderar lokalt i demo-build.

### Fas R5 — Read-only UI-gating (2h)

Skriv om mutation-knappar (Skapa, Spara, Skicka, Radera) så de
respekterar `useIsReadOnly()`:

```tsx
const readOnly = useIsReadOnly();
<button disabled={readOnly} title={readOnly ? "Demo-läge — read-only" : ""}>
  Spara
</button>
```

Audit:
```bash
grep -rln 'useMutation\|onSubmit=' src/app src/components
```

**Deliverable:** Inga mutation-buttons är aktiva i demo, alla har
tooltip-vägledning.

### Fas R6 — Dynamiska routes (2h)

`/matters/[id]`, `/contacts/[id]`, etc. behöver `generateStaticParams()`.
I demo-build:n returneras id:n från fixed-fixtures eller (bättre) från
ett byggtids-fetch av manifest:t:

```ts
// src/app/matters/[id]/page.tsx
export async function generateStaticParams() {
  if (process.env.DEMO_BUILD !== "1") return [];
  // Fetch manifest at build time, parse matter-id:n
  const res = await fetch("https://ulrik-s.github.io/ava-demo/manifest.json");
  const manifest = await res.json();
  return manifest.paths
    .filter((p: string) => p.startsWith("matters/active/"))
    .map((p: string) => ({ id: extractId(p) }));
}
```

Tar bort `[id]`-folder:s från `STASH_PATHS`.

**Deliverable:** Detail-sidor fungerar i demo.

### Fas R7 — Bundle-storlek + lazy-load (2h)

Räkna `out/`-storlek. Om > 5 MB:
1. Splitta routrar via dynamic imports i tRPC-link:en (lazy resolve)
2. Page-level `dynamic()`-imports för tunga components

**Deliverable:** Initial chunk < 1 MB. Övriga routes lazy-loadas.

### Fas R8 — Tester + verifiering (2h)

1. Nya port-tester (per port)
2. Smoke-test för alla demo-routes (vitest med jsdom + DemoBootstrap)
3. Lokal verifiering: bygg, servera, klicka runt
4. Push → CI deploy → live-verify

**Deliverable:** 1300+ tester gröna, demo live, alla sidor klickbara.

## Estimat

| Fas | Tid |
|---|---|
| R1 — Audit | 2h |
| R2 — Ports | 4h |
| R3 — Routrar | 2h |
| R4 — Demo-bootstrap + sidor | 3h |
| R5 — UI gating | 2h |
| R6 — Dynamiska routes | 2h |
| R7 — Bundle-optimering | 2h |
| R8 — Verifiering | 2h |
| **Totalt** | **~19h ≈ 2 arbetsdagar** |

## Risker

- **Test-churn**: routrar-test mockar Prisma direkt; behöver bytas
  till `IDataStore`-mocks. ~30 tester berörda.
- **NextAuth-redirects**: vissa pages använder `useSession()` med
  guards utöver `AuthGuard`. Behöver hittas + ersättas med
  `useCurrentUser()`.
- **Stora detail-pages**: matter/[id]-sidan har komplex layout med
  dokumentlistor, timepost-formulär. Endast read-only-vyn behöver
  fungera; allt formulär-gate:as.
- **Bundle bloat**: ett mått just nu är 2.2 MB statiskt. Med alla
  routrar + sidor + LLM-stubbar kan vi snabbt nå 8-10 MB om vi
  inte är försiktiga. Lazy-loading kritiskt.

## Beslut innan start

1. **NextAuth-shim**: A (mock SessionProvider) eller B (useCurrentUser
   abstraktion)?
2. **Demo-user**: hårdkodad "Demo Advokat" eller pick:as från
   demo-data-repo:ts `.ava/users/`?
3. **Mutation-buttons**: gråa + tooltip, eller helt dölj i demo?
4. **Bundle-mål**: vad är acceptabelt? <1 MB initial, <5 MB totalt?

## Inkrementell strategi (rekommenderas)

Gör inte allt på en gång. Föreslagen ordning:

1. **Dag 1 förmiddag**: R1 + R2 (audit + ports)
2. **Dag 1 eftermiddag**: R3 + R4 (migrera routrar, demo-bootstrap)
   → första list-sidan klickbar lokalt
3. **Dag 2 förmiddag**: R5 + R6 (UI gating, dynamiska routes)
4. **Dag 2 eftermiddag**: R7 + R8 (bundle, verify, ship)

Commit:a och pusha efter varje fas så vi kan rulla tillbaka om något
går söder. CI deployar varje commit.
