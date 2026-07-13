/**
 * Sparsamt, fejkat dokumentinnehåll för den kronologiska seedningen (#880). Korta
 * svenska mallsträngar per dokumenttyp — matas som `summary`/body till
 * `generateDocumentBytes` (PDF/DOCX). Det är seed-data; innehållet behöver bara
 * vara begripligt, inte juridiskt korrekt.
 */

import type { DocumentDirection } from "@/lib/shared/schemas/document";

export interface DocTemplate {
  documentType: string;
  direction: DocumentDirection;
  /** Titel/filnamnsbas. `{m}` ersätts med ärende-titel av anroparen om önskat. */
  title: string;
  summary: string;
}

/** Fördefinierade dokument-mallar (nyckel → mall). Utökas per scenariobehov. */
export const DOC_TEMPLATES: Record<string, DocTemplate> = {
  fullmakt: {
    documentType: "Fullmakt", direction: "UTGAENDE",
    title: "Fullmakt", summary: "Klienten befullmäktigar ombudet att företräda i ärendet.",
  },
  stamningsansokan: {
    documentType: "Stämningsansökan", direction: "UTGAENDE",
    title: "Stämningsansökan", summary: "Ansökan om stämning ges in till tingsrätten med yrkanden och grunder.",
  },
  inlaga: {
    documentType: "Inlaga", direction: "UTGAENDE",
    title: "Inlaga till tingsrätten", summary: "Komplettering av talan samt bemötande av motpartens invändningar.",
  },
  brevTillOmbud: {
    documentType: "Korrespondens", direction: "UTGAENDE",
    title: "Brev till motpartsombud", summary: "Förfrågan om förlikning samt begäran om handlingar.",
  },
  svaromal: {
    documentType: "Svaromål", direction: "INKOMMANDE",
    title: "Svaromål från motpartsombud", summary: "Motparten bestrider käromålet och åberopar egen bevisning.",
  },
  brevFranOmbud: {
    documentType: "Korrespondens", direction: "INKOMMANDE",
    title: "Brev från motpartsombud", summary: "Motpartsombudet återkommer angående förlikning och tidplan.",
  },
  dom: {
    documentType: "Dom", direction: "INKOMMANDE",
    title: "Dom från tingsrätten", summary: "Tingsrätten meddelar dom i målet. Se domslut och domskäl.",
  },
  beslutRattshjalp: {
    documentType: "Beslut", direction: "INKOMMANDE",
    title: "Beslut om rättshjälp", summary: "Rättshjälpsmyndighetens beslut om rättshjälpsavgiftens procentsats för ärendet.",
  },
};
