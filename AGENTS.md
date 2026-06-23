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

1. **Issue first.** Work starts from a GitHub issue (create one if missing).
   Capture follow-ups / tech-debt as issues too so nothing is lost — label
   `architecture` / `tech-debt` / `tooling` / `documentation`.
2. **Branch from `main`**, one topic per branch (`issue-NN-<slug>`).
3. **Conventional Commits** are mandatory — `feat(scope): …`, `fix:`, `chore:`,
   `refactor:`, `docs:`, `test:`, `ci:`. Enforced by `.husky/commit-msg`
   (commitlint, config at `tooling/config/commitlint.config.mjs`) **and** in CI.
   Run `bun install` so the hook's `commitlint` binary is present.
4. **Before opening the PR, verify locally** (CI mirrors these):
   - `bun run quality:fast` — typecheck + type-aware lint + `test:fast`.
   - `bun run build:demo` — the GH Pages static export. **It fails silently in
     CI/Pages otherwise**, so always run it for app changes.
   - `bun run round-trip` — for changes touching the git push/pull e2e path.
5. **Open a PR** to `main`. CI runs four required checks that must be green
   before merge: **Static analysis** (typecheck + ESLint + knip + dep-cruiser
   + jscpd), **Unit / komponent / integration** (`bun test --parallel` + coverage floor),
   **E2E (git round-trip)**, and **Commit messages** (commitlint).
6. **Self-merge.** No approval is required (solo project, 0 required reviews),
   but the PR itself is mandatory — merge your own PR once all four checks are
   green. `gh pr merge --squash` works.

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
overview. Then [`docs/auth.md`](docs/auth.md) for the self-hosted auth model.

## Operational facts (easy to get wrong)

- **`bun run build` does NOT produce `out/`.** `output: "export"` is blocked by
  the `src/app/api/` route handlers. Build the static export with
  `DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh` (it stashes `api/`
  + seeds data + generates `manifest.json` + touches `.nojekyll`).
- The docker `web` container serves `out/` (at `/ava/`) **and** git smart-HTTP
  (`git-http-backend` behind nginx, at `/git/`) from the same origin — so the
  browser pushes to `http://localhost:8080/git/firma.git` with no CORS proxy.
- **`rm -rf out` breaks the docker bind-mount** → restart with:
  `docker compose -f tooling/docker/docker-compose.yml restart web`.
- Run the browser round-trip e2e with `bun run round-trip` (needs docker up +
  `out/` built). Unit tests: `bun run test` (`bun test --parallel`, ~2334
  tester). Per-fil-isolering krävs (annars läcker `mock.module`/stubbar
  mellan filer); `--parallel` ger det via en worker-pool (`--isolate`
  kraschar på CI-linux, epoll). Se [[docs/quality.md]] + #92.

## Two deploy modes (selected by `firma-config.tier`)

- **`demo`** — GH Pages, data fetched from same-origin via `manifest.json`.
  Mutations work in-memory but never persist past a tab reload.
- **`self-hosted`** — OPFS-cloned working copy + iso-git push/pull to
  `localhost:8080/git/firma.git`. Auth via `htpasswd` (Basic-auth header).
  Default-config för localhost-host hostname:n; ändras i `/settings`.

## Data store

- `DemoDataStore` (in-memory) + optional write-back-callback to OPFS via
  `src/lib/client/firma/fsa-write-back.ts`. tRPC routers use
  `ctx.dataStore.transaction(...)`, NOT `raw.$transaction` (Prisma is gone).
- Single source of truth for seed-data: `tooling/scripts/seed-data.ts`.
  `seed-firma-local.ts` and `build-demo-repo.ts` both call `buildSeed(opts)`.

## Auth (self-hosted)

`tooling/docker/web/entrypoint.sh` auto-bootstraps a random admin-PAT on
first start (logged once). Admin adds users with
`tooling/scripts/add-user.sh <email>`. No custom auth-server in default
stack — just nginx `auth_basic` + htpasswd. See [`docs/auth.md`](docs/auth.md).

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
