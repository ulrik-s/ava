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
  /**
   * Undermapp inom mottagarens mapp (#985). Utelämnad → dokumentet läggs direkt
   * i mottagarmappen. Finns för att demon ska visa att träd-vyn kan NÄSTLA —
   * en platt mappstruktur hade sett ut som att funktionen saknas.
   */
  subFolder?: string;
  /**
   * Dokumentets BRÖDTEXT (#988), när den behöver se ut som en riktig handling.
   * `summary` är metadata i en mening; `body` är det som faktiskt står i filen
   * och det extraktionen läser.
   *
   * Bara handlingar som bär parter eller kallelser har en — resten klarar sig
   * med sin summary. Poängen är inte att fylla demon med text, utan att
   * `SuggestionsPanel` och `EventsPanel` ska ha något att visa.
   */
  body?: string;
}

/**
 * Mottagare → mapp (#985). Byrån filar efter vem dokumentet gick till eller kom
 * från; det är den indelning träd-vyns drag-and-drop är gjord för. Demon hade
 * inga mappar alls — varje dokument låg i roten, så mapphanteringen gick varken
 * att se eller prova.
 */
export const FOLDER_BY_RECIPIENT: Record<DocumentRecipient, string> = {
  KLIENT: "Klient",
  DOMSTOL: "Domstol",
  MOTPART: "Korrespondens",
  MYNDIGHET: "Myndighetsbeslut",
  FORSAKRING: "Försäkring",
  OVRIGT: "Övrigt",
};

/** Fördefinierade dokument-mallar (nyckel → mall). Utökas per scenariobehov. */
export const DOC_TEMPLATES: Record<string, DocTemplate> = {
  fullmakt: {
    documentType: "Fullmakt", direction: "UTGAENDE", recipient: "KLIENT",
    title: "Fullmakt", summary: "Klienten befullmäktigar ombudet att företräda i ärendet.",
  },
  stamningsansokan: {
    documentType: "Stämningsansökan", direction: "UTGAENDE", recipient: "DOMSTOL",
    title: "Stämningsansökan", summary: "Ansökan om stämning ges in till tingsrätten med yrkanden och grunder.",
    // Partsblocket är det extraktionen (#988) läser: rollord + namn + person-
    // respektive organisationsnummer, precis som i en riktig ansökan.
    body: [
      "STÄMNINGSANSÖKAN",
      "Kärande: Anna Andersson 850312-4567",
      "Ombud: Advokat Erik Lundqvist",
      "Svarande: Byggfirma Stenhammar AB 556677-8899",
      "Motpartens ombud: Advokat Sofia Grip",
      "",
      "Käranden yrkar att tingsrätten förpliktar svaranden att utge skadestånd.",
      "Muntlig förberedelse har satts ut till 2026-09-15 kl. 09.30.",
    ].join("\n"),
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
    body: [
      "SVAROMÅL",
      "Svarande: Byggfirma Stenhammar AB 556677-8899",
      "Motpartens ombud: Advokat Sofia Grip",
      "Vittne: Karl Nilsson 720801-1234",
      "",
      "Svaranden bestrider käromålet i dess helhet och åberopar egen bevisning.",
    ].join("\n"),
  },
  brevFranOmbud: {
    documentType: "Korrespondens", direction: "INKOMMANDE", recipient: "MOTPART",
    title: "Brev från motpartsombud", summary: "Motpartsombudet återkommer angående förlikning och tidplan.",
  },
  dom: {
    documentType: "Dom", direction: "INKOMMANDE", recipient: "DOMSTOL",
    title: "Dom från tingsrätten", summary: "Tingsrätten meddelar dom i målet. Se domslut och domskäl.",
    subFolder: "Domar",
    body: [
      "DOM",
      "Huvudförhandling hölls den 12 maj 2026 kl. 09.00.",
      "Kärande: Anna Andersson 850312-4567",
      "Svarande: Byggfirma Stenhammar AB 556677-8899",
      "",
      "Tingsrätten förpliktar svaranden att utge skadestånd till käranden.",
      "Frist för överklagande: senast den 2026-06-02.",
    ].join("\n"),
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
