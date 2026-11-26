/**
 * Standardmapparna som varje nytt ärende får (#1228). Byråns filingsystem:
 * fakturor, domstolshandlingar (med undermappar per typ), beslut,
 * korrespondens, avtal och resten.
 *
 * Trädet är DATA, inte kod: en ny nivå eller mapp läggs till här och följer
 * automatiskt med i `matter.create` och backfill-skriptet
 * (`tooling/scripts/backfill-matter-folders.ts`). Ordningen är skapandeordning;
 * dokumentträdet sorterar på namn.
 *
 * Namnrutan föreslår en mapp ur handlingens typ (#1975): `KIND_FOLDER_PATHS`
 * och `suggestedFolderPath`.
 */

import { guessFromFilename, type DocumentKind } from "./document-kind";
import { isEmlFile } from "./eml-subject";

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

/** Mappen dit det som saknar en egen mapp hamnar — förslagets sista utväg. */
export const OTHER_FOLDER = "Övrigt";

/** Mappen för mejl som inte är en handling med egen mapp. */
const CORRESPONDENCE_FOLDER = "Korrespondens";

/**
 * Sorteringen typ → mapp (#1975): sökvägen som mappnamn från roten, eller
 * `null` när typen inte har en egen mapp. En `Record` över alla typer gör att en
 * ny typ i `KNOWN_KINDS` inte kompilerar förrän någon valt dess mapp.
 */
export const KIND_FOLDER_PATHS: Readonly<Record<DocumentKind, readonly string[] | null>> = {
  KALLELSE: ["Domstol", "Kallelse"],
  FORELAGGANDE: ["Domstol", "Föreläggande"],
  FORORDNANDE: ["Domstol", "Förordnande"],
  STAMNING: ["Domstol", "Inlagor"],
  INLAGA: ["Domstol", "Inlagor"],
  DELGIVNINGSKVITTO: ["Domstol"],
  DOM: ["Beslut"],
  FAKTURA: ["Faktura"],
  KOSTNADSRAKNING: ["Faktura"],
  AVTAL: ["Avtal"],
  FUP: null,
  BEVIS: null,
  FULLMAKT: null,
  RAPPORT: null,
  EPOST: null,
  OKLASSIFICERAT: null,
};

/** Är filen ett mejl? Avgörs på filen (`.eml`, `.msg` eller `message/rfc822`), inte på namnet i rutan. */
export function isMailFile(fileName: string, mimeType: string): boolean {
  return isEmlFile(fileName, mimeType) || fileName.toLowerCase().endsWith(".msg");
}

/**
 * Den föreslagna mappen för en handling med namnet `name` (filnamnet eller
 * mejlets ämnesrad): typens egen mapp (`guessFromFilename`), annars
 * Korrespondens för ett mejl och Övrigt för allt annat.
 */
export function suggestedFolderPath(name: string, isEmail: boolean): readonly string[] {
  return KIND_FOLDER_PATHS[guessFromFilename(name)] ?? [isEmail ? CORRESPONDENCE_FOLDER : OTHER_FOLDER];
}
