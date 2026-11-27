<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

* Use DRY, SOLID principles for all code written
* Use tools for checking architecture and cyclomatic complexity (should always stay below 8)
* For each line of code written there must be a test that covers that line of code
* Build unit tests, integration tests, system tests and end-to-end tests
* For UI test use playwright
* Always check api, documentation etc on the web do not rely on memory

## Workflow — Issue → PR → Merge (`main` is protected)

**All changes land via a green PR. Do NOT push directly to `main`** — branch
protection enforces this for everyone, admins included (`enforce_admins`).
Force-push and branch deletion on `main` are blocked.

The loop for every change:

1. **Inkorgen först.** Nytt arbete — idéer, buggar, uppföljningar, teknisk
   skuld — blir ett issue i `ulrik-s/ava-feedback` (inkorgen) med `intern` och
   `bugg` eller `förslag`. Loop 1 verifierar, Ulrik beslutar (`verifierad`) och
   loop 2 bryter ner i arbetsorder (`agent-task`) i `ulrik-s/ava`. I `ava` hör
   bara arbetsorder hemma: klockan flyttar ett issue där utan arbetsorder-flagga
   till inkorgen när det är äldre än 2 timmar och ingen öppen PR stänger det.
   Bygger du något direkt (Ulrik ber om det i en session): skapa issuet i `ava`
   och öppna PR:en direkt. Se [`docs/feedback-pipeline.md`](docs/feedback-pipeline.md).
   **Stäng med `Closes #N`** i PR:en: GitHub känner inte igen "Stänger", och
   "Refs" stänger inget (15 klara issues stod öppna, genomgången 2026-11-18).
2. **Branch from `main`**, one topic per branch (`issue-NN-<slug>`).
3. **Conventional Commits** are mandatory — `feat(scope): …`, `fix:`, `chore:`,
   `refactor:`, `docs:`, `test:`, `ci:`. Enforced by `.husky/commit-msg`
   (commitlint, config at `tooling/config/commitlint.config.mjs`) **and** in CI.
   Run `bun install` so the hook's `commitlint` binary is present.
4. **Before opening the PR, verify locally** (CI mirrors these):
   - `bun run quality:fast` — typecheck + type-aware lint + `file-size` +
     `knip:production` + `test:fast`.
   - `bun run build:demo` — the GH Pages static export. **It fails silently in
     CI/Pages otherwise**, so always run it for app changes.
   - `bun run e2e:demo` — the browser suite against the built `out/`. Run it for
     UI changes and for anything that moves demo-data.
   - `bun run e2e:conflict` / `bun run e2e:oidc` — only when you touch the
     conflict (keep-both) or login paths; both need docker up.
5. **Open a PR** to `main`. CI runs the full matrix and every check must be green
   before merge. In `.github/workflows/ci.yml`: **Commit messages** (commitlint),
   **Static analysis** (typecheck, lint, `lint:complexity-strict`, `deps:check`,
   `file-size`, `knip`, `knip:production`, `duplicates` and
   `db:check-migrations`), **Unit / komponent / integration**
   (`bun test --parallel` + coverage floor), **Repository (Postgres)**,
   **Server-first (deploy E2E)**, **Återställningsövning (backup → förstör →
   återställ)**, **E2E (OIDC login)**, **Demo build** (static export +
   bundle-size ratchet), **Demo E2E (browser-smoke)**, **Outlook-tillägg E2E
   (Chromium + WebKit)** and **Keep-both konflikt-E2E**. In
   `.github/workflows/security.yml`: **CodeQL (JS/TS)** and **Sårbara beroenden
   (bun audit)**.
6. **Self-merge.** No approval is required (solo project, 0 required reviews),
   but the PR itself is mandatory — merge your own PR once CI is green.
   `gh pr merge --squash` works. A check that fails on infrastructure (a runner
   that disappears mid-job) is re-run, never merged past.

`.github/CODEOWNERS` marks the architecture-critical paths (`tooling/config/`,
`src/lib/shared/schemas/`, `.github/`) — review them with extra care.

### Quality ratchet — gates only tighten

Coverage thresholds (`tooling/scripts/run-tests.ts`), the lint
`--max-warnings` cap, and knip are **ratchets**: anchored just under today's
numbers and only moved tighter. **Never loosen a gate to land code** — fix the
code or extract a sub-component (a "ratchet-step", cf. PR #6). See
[`docs/quality.md`](docs/quality.md).

## Where to start

Read [`docs/architecture.md`](docs/architecture.md) first — it's the canonical
overview. Then [ADR 0009](docs/adr/0009-oidc-login-via-servern.md) for the
login model.

## Operational facts (easy to get wrong)

- **`bun run build` does NOT produce `out/`.** `output: "export"` is blocked by
  the `src/app/api/` route handlers. Build the static export with
  `DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh` (it stashes `api/`
  + seeds data + generates `manifest.json` + touches `.nojekyll`).
- The docker `web` container serves `out/` (at `/ava/`). Which stack:
  - `tooling/docker/docker-compose.yml` is started by the `tier3:*` scripts and
    by the OIDC E2E (`tooling/scripts/e2e-oidc.sh`, together with
    `tooling/docker/docker-compose.oidc.yml`);
  - the conflict E2E (`e2e:conflict`, `tooling/scripts/conflict-e2e.sh`) starts
    `tooling/docker/docker-compose.selfhosted-local.yml`, which has its own
    `web` serving `out/` behind oauth2-proxy and keycloak.
- **`rm -rf out` breaks the docker bind-mount** of the
  `tooling/docker/docker-compose.yml` stack → restart with:
  `docker compose -f tooling/docker/docker-compose.yml restart web` (same as
  `bun run tier3:restart`).
- Run the browser e2e with `bun run e2e:demo` (needs `out/` built; the config
  serves it itself — no docker required). Unit tests: `bun run test`
  (`bun test --parallel`). Per-fil-isolering krävs (annars läcker `mock.module`/stubbar
  mellan filer); `--parallel` ger det via en worker-pool (`--isolate`
  kraschar på CI-linux, epoll). Se [[docs/quality.md]] + #92.

## Two deploy modes (selected by `firma-config.tier`)

- **`demo`** — GH Pages. The same offline-first core with no real sync target:
  a `StaticSyncSource` loopback serves the bundled `demo-seed.json`, which
  hydrates IndexedDB through the normal reconcile/pull path (ADR 0025).
- **`self-hosted`** — server-first (ADR 0016): Postgres + tRPC-over-HTTP behind
  oauth2-proxy; the production stack is
  `tooling/docker/docker-compose.production.yml`. The client is built with
  `AVA_BUILD_TARGET=server` (`tooling/scripts/build-demo.sh`) and is
  offline-first with a local store, a mutation queue and reconcile
  (ADR 0017/0037).

## Data store

- The server reaches data through the typed repository `ctx.repos`
  (ADR 0020).
- The schema is Drizzle with SQL migrations in `tooling/db/migrations/`
  (ADR 0019); zod is the source of truth.
- Background jobs run in pg-boss (ADR 0024).
- Single source of truth for seed-data: `tooling/scripts/seed-data.ts`.
  `build-demo-repo.ts` and `seed-demo-into-server.ts` both call
  `buildSeed(opts)`.

## Auth

People log in with OIDC via oauth2-proxy (ADR 0009). The CLI and the add-in use
a Bearer token (ADR 0013/0035). See
[ADR 0009](docs/adr/0009-oidc-login-via-servern.md).

# 🛡️ TypeScript Strict Mode

You are a Type-Level Architect. Your mission is to eliminate runtime errors through rigorous, compile-time type safety. You don't just "use TypeScript"; you push the compiler to its absolute limits.

## ⚖️ Core Principles
1. **No-Any Policy**: `any` is a failure of imagination. Use `unknown` + narrowing, or complex generics, but never skip validation.
2. **Explicit is Better**: Prefer explicit return types and discriminated unions over implicit inference for public APIs.
3. **Soundness Above All**: Avoid non-null assertions (`!`) and unsafe type casting (`as`). If you must cast, explain why in a comment.

## 🛠️ Thinking Process
1. **Domain Modeling**: Start with the data. Map out all possible states using Discriminated Unions.
2. **Generic Extraction**: Identify patterns. Can this logic be made reusable with Generics?
3. **Validation Layer**: Where does the data come from? Implement runtime validation (Zod, Valibot) that synchronizes with your types.
4. **Exhaustiveness Check**: Ensure every possible case is handled using `never` checks in switches.

## 🚀 Tool-Specific Tips
- **Cursor/Windsurf**: Use `@Codebase` to find existing type definitions before creating new ones. Use "Go to Definition" frequently to understand nested interfaces.
- **TSDocs**: Always add JSDoc comments (`/** ... */`) to exported types to provide IDE hover context for other developers.

## ✅ Type Safety Matrix
- **Null Safety**: `strictNullChecks` | Prevents the 'undefined is not a function' nightmare.
- **Index Access**: `noUncheckedIndexedAccess` | Forces handling of missing keys in objects/arrays.
- **Inference**: `noImplicitAny` | Ensures every variable has a traceable type.
- **Unions**: Discriminated Unions | Enables clean, exhaustive pattern matching.

## 📉 Common Pitfalls
- **Over-typing**: Creating 100-line types for simple objects. Keep it readable.
- **Type Casting**: Using `as unknown as T` to "shut up" the compiler. This is a debt that will collect interest in production.
