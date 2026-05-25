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

## Where to start

Read [`docs/architecture.md`](docs/architecture.md) first — it's the canonical
overview. Then [`docs/auth.md`](docs/auth.md) for the self-hosted auth model.

## Operational facts (easy to get wrong)

- **`yarn build` does NOT produce `out/`.** `output: "export"` is blocked by
  the `src/app/api/` route handlers. Build the static export with
  `DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh` (it stashes `api/`
  + seeds data + generates `manifest.json` + touches `.nojekyll`).
- The docker `web` container serves `out/` (at `/ava/`) **and** git smart-HTTP
  (`git-http-backend` behind nginx, at `/git/`) from the same origin — so the
  browser pushes to `http://localhost:8080/git/firma.git` with no CORS proxy.
- **`rm -rf out` breaks the docker bind-mount** → restart with:
  `docker compose -f tooling/docker/docker-compose.yml restart web`.
- Run the browser round-trip e2e with `yarn round-trip` (needs docker up +
  `out/` built). Unit tests: `yarn test:fast` (~1646 tests, ~14s).

## Two deploy modes (selected by `firma-config.tier`)

- **`demo`** — GH Pages, data fetched from same-origin via `manifest.json`.
  Mutations work in-memory but never persist past a tab reload.
- **`self-hosted`** — OPFS-cloned working copy + iso-git push/pull to
  `localhost:8080/git/firma.git`. Auth via `htpasswd` (Basic-auth header).
  Default-config för localhost-host hostname:n; ändras i `/settings`.

## Data store

- `DemoDataStore` (in-memory) + optional write-back-callback to OPFS via
  `src/client/lib/firma/fsa-write-back.ts`. tRPC routers use
  `ctx.dataStore.transaction(...)`, NOT `raw.$transaction` (Prisma is gone).
- Single source of truth for seed-data: `tooling/scripts/seed-data.ts`.
  `seed-firma-local.ts` and `build-demo-repo.ts` both call `buildSeed(opts)`.

## Auth (self-hosted)

`tooling/docker/web/entrypoint.sh` auto-bootstraps a random admin-PAT on
first start (logged once). Admin adds users with
`tooling/scripts/add-user.sh <email>`. No custom auth-server in default
stack — just nginx `auth_basic` + htpasswd. See [`docs/auth.md`](docs/auth.md).
