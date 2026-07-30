<!-- Flöde: Issue → PR → grön CI → self-merge (AGENTS.md). `main` är skyddad. -->

## Vad & varför

<!-- Kort: vad ändras och varför. -->

Stänger #

## Typ

- [ ] `feat` — ny funktion
- [ ] `fix` — buggfix
- [ ] `refactor` / `perf`
- [ ] `docs` / `test` / `chore` / `ci`

## Verifierat lokalt (speglar CI)

- [ ] `bun run quality:fast` — typecheck + type-aware lint + `test:fast`
- [ ] `bun run build:demo` — statisk export (fallerar annars TYST i CI/Pages)
- [ ] Berörda E2E: `bun run round-trip` / `bun run e2e:oidc` / `bun run e2e:conflict` (om relevant)
- [ ] Nya rader har täckande tester (coverage-ratchet hålls eller höjs)
- [ ] Commits följer Conventional Commits (commitlint)

## Kvalitetsgrindar

- [ ] Inga gater lösgjorda (coverage/lint-cap/knip/bundle-size är ratchets — de tightnar bara)
- [ ] Vid arkitektur-/tooling-kritiska paths (`tooling/config/`, `src/lib/shared/schemas/`, `.github/`): extra noggrant granskat (CODEOWNERS)

## Övrigt

<!-- Skärmdumpar, avvägningar, uppföljande issues (labels: architecture/tech-debt/tooling/documentation). -->
