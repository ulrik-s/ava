/**
 * Sparsamt, fejkat dokumentinnehåll för den kronologiska seedningen (#880). Korta
 * svenska mallsträngar per dokumenttyp — matas som `summary`/body till
 * `generateDocumentBytes` (PDF/DOCX). Det är seed-data; innehållet behöver bara
 * vara begripligt, inte juridiskt korrekt.
 */

import type { DocumentDirection, DocumentRecipient } from "@/lib/shared/schemas/document";

export interface DocTemplate {
  documentType: string;
  direction: DocumentDirection;
  /** Motpart/mottagare (#901) — driver "dok skickade till domstol"-filtret. */
  recipient: DocumentRecipient;
  /** Titel/filnamnsbas. `{m}` ersätts med ärende-titel av anroparen om önskat. */
  title: string;
  summary: string;
}

/** Fördefinierade dokument-mallar (nyckel → mall). Utökas per scenariobehov. */
export const DOC_TEMPLATES: Record<string, DocTemplate> = {
  fullmakt: {
    documentType: "Fullmakt", direction: "UTGAENDE", recipient: "KLIENT",
    title: "Fullmakt", summary: "Klienten befullmäktigar ombudet att företräda i ärendet.",
  },
  stamningsansokan: {
    documentType: "Stämningsansökan", direction: "UTGAENDE", recipient: "DOMSTOL",
    title: "Stämningsansökan", summary: "Ansökan om stämning ges in till tingsrätten med yrkanden och grunder.",
  },
  inlaga: {
    documentType: "Inlaga", direction: "UTGAENDE", recipient: "DOMSTOL",
    title: "Inlaga till tingsrätten", summary: "Komplettering av talan samt bemötande av motpartens invändningar.",
  },
  brevTillOmbud: {
    documentType: "Korrespondens", direction: "UTGAENDE", recipient: "MOTPART",
    title: "Brev till motpartsombud", summary: "Förfrågan om förlikning samt begäran om handlingar.",
  },
  svaromal: {
    documentType: "Svaromål", direction: "INKOMMANDE", recipient: "MOTPART",
    title: "Svaromål från motpartsombud", summary: "Motparten bestrider käromålet och åberopar egen bevisning.",
  },
  brevFranOmbud: {
    documentType: "Korrespondens", direction: "INKOMMANDE", recipient: "MOTPART",
    title: "Brev från motpartsombud", summary: "Motpartsombudet återkommer angående förlikning och tidplan.",
  },
  dom: {
    documentType: "Dom", direction: "INKOMMANDE", recipient: "DOMSTOL",
    title: "Dom från tingsrätten", summary: "Tingsrätten meddelar dom i målet. Se domslut och domskäl.",
  },
  beslutRattshjalp: {
    documentType: "Beslut", direction: "INKOMMANDE", recipient: "MYNDIGHET",
    title: "Beslut om rättshjälp", summary: "Rättshjälpsmyndighetens beslut om rättshjälpsavgiftens procentsats för ärendet.",
  },
  // Jämknings-beslut om rättshjälpsavgiftens procentsats (#901) — 5 % resp. 40 %.
  beslutRattshjalpAvgift5: {
    documentType: "Beslut", direction: "INKOMMANDE", recipient: "MYNDIGHET",
    title: "Beslut om rättshjälpsavgift — 5 %", summary: "Rättshjälpsmyndighetens beslut: rättshjälpsavgiften fastställs till 5 % (arbetslös, lågt ekonomiskt underlag).",
  },
  beslutRattshjalpAvgift40: {
    documentType: "Beslut", direction: "INKOMMANDE", recipient: "MYNDIGHET",
    title: "Beslut om rättshjälpsavgift — 40 %", summary: "Rättshjälpsmyndighetens jämkningsbeslut: rättshjälpsavgiften höjs till 40 % efter att klienten fått anställning (högre ekonomiskt underlag).",
  },
  rattsskyddsansokan: {
    documentType: "Ansökan", direction: "UTGAENDE", recipient: "FORSAKRING",
    title: "Ansökan om rättsskydd", summary: "Begäran till försäkringsbolaget om att rättsskyddet i hemförsäkringen ska tas i anspråk för tvisten.",
  },
  rattsskyddAvslag: {
    documentType: "Beslut", direction: "INKOMMANDE", recipient: "FORSAKRING",
    title: "Avslag på rättsskydd", summary: "Försäkringsbolaget avslår rättsskydd — tvist anses ännu inte ha uppkommit. Ärendet drivs istället med rättshjälp.",
  },
  rattsskyddBeslutPositivt: {
    documentType: "Beslut", direction: "INKOMMANDE", recipient: "FORSAKRING",
    title: "Beslut om rättsskydd", summary: "Försäkringsbolaget beviljar rättsskydd: ersätter högst 100 timmar arvode till eget ombud. Från ersättningen avräknas självrisk 20 %, dock lägst 1 800 kr.",
  },
};
