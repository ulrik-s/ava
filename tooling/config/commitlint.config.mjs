// Commitlint-konfiguration — enforcar Conventional Commits.
// Körs lokalt av .husky/commit-msg och i CI (PR-titel) via `bun run commitlint`.
const config = {
  extends: ['@commitlint/config-conventional'],
};

export default config;
