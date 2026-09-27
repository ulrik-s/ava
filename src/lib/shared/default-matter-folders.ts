/**
 * Standardmapparna som varje nytt ärende får (#1228). Byråns filingsystem:
 * fakturor, domstolshandlingar (med undermappar per typ), beslut,
 * korrespondens, avtal och resten.
 *
 * Trädet är DATA, inte kod: en ny nivå eller mapp läggs till här och följer
 * automatiskt med i `matter.create` och backfill-skriptet
 * (`tooling/scripts/backfill-matter-folders.ts`). Ordningen är skapandeordning;
 * dokumentträdet sorterar på namn.
 */

/** En mapp i standardträdet, med valfria undermappar. */
export interface DefaultFolderNode {
  /** Visningsnamn — matchas skiftlägesokänsligt mot befintliga mappar i samma förälder. */
  readonly name: string;
  /** Undermappar som skapas under denna mapp. */
  readonly children?: readonly DefaultFolderNode[];
}

/** Standardträdet för ett ärendes dokumentmappar (rotnivån först). */
export const DEFAULT_MATTER_FOLDERS: readonly DefaultFolderNode[] = [
  { name: "Faktura" },
  {
    name: "Domstol",
    children: [
      { name: "Kallelse" },
      { name: "Föreläggande" },
      { name: "Förordnande" },
      { name: "Inlagor" },
    ],
  },
  { name: "Beslut" },
  { name: "Korrespondens" },
  { name: "Avtal" },
  { name: "Övrigt" },
];
