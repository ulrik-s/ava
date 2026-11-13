/**
 * Versionstexten som visas i gränssnittet (#1578): `v0.7.11 · 13 nov 2026`.
 * Ren funktion, delad av sidomenyn och utloggad-sidan via `AppVersion`.
 */

/** Dag + kort månad + år på svenska, i Stockholmstid (den avgör dagen nära midnatt UTC). */
const DATE_FMT = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Stockholm",
});

/** ISO-datum → `13 nov 2026` (ICU:s avslutande punkt, `nov.`, tas bort). Ogiltigt → tomt. */
function formatVersionDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FMT.format(date).replaceAll(".", "");
}

/**
 * `git describe`-version + commit-datum → `v<version> · <datum>`.
 * Versionen visas som den är (ett inledande `v` dubbleras inte). Saknas
 * versionen blir texten tom; saknas datumet visas bara versionen.
 */
export function formatAppVersion(version: string, date: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "";
  const label = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  const day = formatVersionDate(date);
  return day ? `${label} · ${day}` : label;
}
