# Fas R1 — Audit av Node-only imports

Genererad: 2026-05-19.

## Polluterande imports (direkta)

| Fil | Importerar | Node-modul |
|---|---|---|
| `src/server/services/email.ts` | `nodemailer` | `fs`, `dns`, `net`, `tls` |
| `src/server/services/document-analysis.ts` | `fs/promises`, `path` | direkt fs |
| `src/server/local-first/node-git-ops.ts` | `child_process` | direkt |
| `src/server/local-first/node-fs.ts` | `fs`, `path` | direkt |
| `src/server/db.ts` | `@prisma/adapter-pg` (lazy via require) | indirekt via `pg`/`pgpass` |
| `src/client/lib/auth.ts` | `next-auth`, `bcryptjs`, `next-auth/providers/*` | indirekt |

## Polluterande imports (transitiva via `appRouter`)

```
appRouter (_app.ts)
  └─ document/core.ts
      └─ services/meilisearch.ts        (fetch — browser-safe)
      └─ services/document-analysis.ts  ⚠ fs, path, pdf-parse
  └─ trpc.ts
      └─ db.ts                          ⚠ prisma adapter
      └─ lib/auth.ts                    ⚠ next-auth providers, bcryptjs
      └─ data-store/PostgresStore.ts    (type-only — OK)
      └─ services/payment-scan-listener.ts
          └─ services/payment-scan.ts   ⚠ kan dra in mer
```

## Ports att introducera

| Port | Ersätter | No-op-demo |
|---|---|---|
| `IDocumentAnalyzer` | `services/document-analysis` | `NoopDocumentAnalyzer` |
| `IEmailSender` | `services/email` | `NoopEmailSender` |
| `IPaymentScanner` | `services/payment-scan` | `NoopPaymentScanner` |
| `ISearchIndex` | `services/meilisearch` | `InMemorySearchIndex` |

## Strategisk omstrukturering av `trpc.ts`

Dela upp i:

- `trpc-core.ts` — `initTRPC`, `Context`-type, procedures. Inga konkreta beroenden.
- `trpc-server.ts` — `createContext` med Prisma, NextAuth, services. Server-only.
- `trpc-demo.ts` — `createDemoContext` med DemoDataStore + Noop:s. Browser-safe.

`appRouter` importerar bara `trpc-core`. Då är `import { appRouter } from "@/server/routers/_app"` säkert i browser.

## Plan-justering

Med audit klar är arbetslistan tydligare:

1. **R2a**: Skapa 4 ports + 2 implementationer var (real + noop) — 4 nya ports × 30 min = 2h
2. **R2b**: Refaktorera `trpc.ts` → `trpc-core`/`trpc-server` split — 1h
3. **R3**: Migrera `document/core.ts` att använda ports från ctx — 30 min
4. **R3b**: Migrera `payment-scan-listener` → port — 30 min
5. **R4**: Demo-bootstrap + ta sidor ur stash — 2h
6. **R5–R8**: per plan-doc

Estimat oförändrat: ~19h totalt.
