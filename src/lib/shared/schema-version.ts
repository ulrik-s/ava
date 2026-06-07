/**
 * Datamodellens version + versionsgrind ([ADR 0004]).
 *
 * Git-backenden lagrar all data i ANVÄNDARENS repo. En godtycklig kombination
 * av kod-version och data-version kan därför mötas vid hydrering. Det här är
 * den enda kopplingen mellan dem:
 *
 *   - `CURRENT_SCHEMA_VERSION` — vilken datamodell den här koden skriver/läser.
 *   - `assertRepoSchemaCompatible` — grinden som körs efter klon, FÖRE hydrering.
 *
 * Ramverks-agnostisk (ren TS): körs i alla lager och i build-scripten.
 *
 * [ADR 0004]: ../../../docs/adr/0004-schemaversion-och-versionsgrind.md
 */

/**
 * Datamodellens version. **Bumpa BARA vid en BRYTANDE schemaändring** (rename,
 * typbyte, fält som blir obligatoriskt) — och para alltid en bump med en
 * migrate-on-read-kedja. Additiva optionella fält bärs av schemats
 * `.passthrough()` och kräver ingen bump.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Repots datamodell är NYARE än den här koden förstår. Att fortsätta vore
 * farligt: en gammal kod-version skulle passthrough-droppa fält den inte
 * känner till och skriva tillbaka en stympad rad → tyst datakorruption.
 */
export class IncompatibleSchemaVersionError extends Error {
  constructor(
    readonly repoVersion: number,
    readonly codeVersion: number,
  ) {
    super(
      `Repot skrevs av en nyare AVA-version (schemaVersion ${repoVersion}) än ` +
        `den här (${codeVersion}). Uppdatera AVA innan du öppnar repot.`,
    );
    this.name = "IncompatibleSchemaVersionError";
  }
}

/**
 * Tolka ett rått `schemaVersion`-värde (typiskt ur `.ava/meta.json`). Saknat
 * eller ogiltigt → `undefined` (grinden tolkar det som baslinje, se nedan).
 */
export function parseSchemaVersion(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0
    ? raw
    : undefined;
}

/**
 * Versionsgrind. Kör efter klon/läsning av repots `schemaVersion`, INNAN
 * domänen ser någon rad. Fyra fall ([ADR 0004]):
 *
 *   - saknas (`undefined`) → tolka som v1-baslinje (repon skapade före ADR:t) → OK
 *   - repo === kod         → OK
 *   - repo  <  kod         → OK (migrate-on-read lyfter raderna i en senare fas)
 *   - repo  >  kod         → kasta {@link IncompatibleSchemaVersionError}
 */
export function assertRepoSchemaCompatible(
  repoVersion: number | undefined,
  codeVersion: number = CURRENT_SCHEMA_VERSION,
): void {
  const v = repoVersion ?? 1;
  if (v > codeVersion) {
    throw new IncompatibleSchemaVersionError(v, codeVersion);
  }
}
