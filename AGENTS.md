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

## Local-first round-trip — START HERE when continuing that work

Read [`docs/roundtrip-handoff.md`](docs/roundtrip-handoff.md) FIRST. It captures
the self-hosted browser↔git round-trip (what's built, how, what remains).

Critical operational facts (easy to get wrong):
* **`yarn build` does NOT produce `out/`.** `output: "export"` is blocked by the
  `src/app/api/` route handlers. Build the static export with
  `DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh` (it stashes `api/` etc.).
* The docker `web` container serves `out/` (at `/ava/`) **and** git smart-HTTP
  (`git-http-backend` behind nginx, at `/git/`) from the same origin — so the
  browser pushes to `http://localhost:8080/git/firma.git` with no CORS proxy.
* **`rm -rf out` breaks the docker bind-mount** → `docker compose -f tooling/docker/docker-compose.yml restart web`.
* Run the browser round-trip e2e with `yarn round-trip` (needs docker up + `out/`
  built). Unit tests: `yarn test:fast` (2 pre-existing `document-content-cache`
  failures are unrelated).
* Three deploy modes share one codebase, selected by `firma-config` tier:
  `demo` (GH Pages, read-only), `self-hosted` (OPFS + iso-git, the round-trip),
  `server` (Tier-2 Postgres dev, `tooling/docker/docker-compose.dev.yml` + `yarn scenarios`).
* Self-hosted data store is `DemoDataStore` (in-memory + write-back to the OPFS
  git working copy). Routers use `ctx.dataStore.transaction(...)`, NOT
  `raw.$transaction`. Write-back paths live in `src/client/lib/firma/fsa-write-back.ts`.

