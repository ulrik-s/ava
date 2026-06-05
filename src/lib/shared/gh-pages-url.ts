/**
 * Översätt en användar-angiven repo-URL till dess GH Pages-URL. Ren
 * sträng→sträng-funktion utan IO — delad kod, används av både demo-loadern
 * (server/local-first) och klient-sidans demo-meta/bootstrap.
 *
 * Heuristik:
 *   - `github.com/<user>/<repo>` → `<user>.github.io/<repo>`
 *   - `<user>/<repo>`           → `<user>.github.io/<repo>`
 *   - allt annat returneras som-är (antas vara redan korrekt)
 */
export function resolveGhPagesUrl(input: string): string {
  const trimmed = input.replace(/\/+$/, "");

  // github.com/<user>/<repo> eller https://github.com/<user>/<repo>
  const gh = trimmed.match(/^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (gh) return `https://${gh[1]}.github.io/${gh[2]}`;

  // user/repo (kort form)
  const short = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (short) return `https://${short[1]}.github.io/${short[2]}`;

  return trimmed;
}
