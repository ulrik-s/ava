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
   *
   * En funktion när texten beror på ärendet — datum räknade från när handlingen
   * kom, och parter som skiljer sig mellan ärendena ("Kallelse").
   */
  body?: string | ((v: BodyVars) => string);
}

/** Det en ärendeberoende brödtext får veta. */
export interface BodyVars {
  /** När handlingen kom in. */
  at: Date;
  /** Ett tal per ärende — väljer parter ur listorna, så ärendena skiljer sig. */
  seed: number;
  /** Brottmål (offentligt uppdrag): huvudförhandling och åklagare i stället för
   *  muntlig förberedelse och motpartsombud. */
  criminal: boolean;
}

/** Mallens brödtext för ärendet, eller undefined om den saknar en. */
export function bodyOf(t: DocTemplate, v: BodyVars): string | undefined {
  return typeof t.body === "function" ? t.body(v) : t.body;
}

const WITNESSES: ReadonlyArray<readonly [string, string]> = [
  ["Karin Holm", "780415-2231"], ["Per Sandberg", "690921-4412"], ["Lena Ek", "810303-5520"],
  ["Mats Berglund", "750612-3318"], ["Sara Lind", "880130-6624"], ["Jonas Wikström", "720818-1137"],
  ["Eva Nyström", "660505-2249"],
];
const COUNSEL = ["Helena Kjellberg", "Johan Ahlström", "Maria Ferm", "Olof Tegnér", "Ingrid Palm"];
const PROSECUTORS = ["Anders Frid", "Cecilia Wahl", "Magnus Öberg"];

/** "2026-10-14" — lokal dag, som domstolarnas kallelser skriver den. */
function dayOf(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAfter(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Element `seed` ur listan (listorna är aldrig tomma). */
function pickFrom<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length] as T;
}

/**
 * Domstolens kallelse: förhandlingen 3–6 veckor efter att kallelsen kom, en
 * frist för bevisuppgift efter 10 dagar, ett vittne och motpartsombudet (i
 * brottmål åklagaren). Ger ärendet både händelseförslag och kontaktförslag.
 */
function kallelseBody({ at, seed, criminal }: BodyVars): string {
  const [witness, pnr] = pickFrom(WITNESSES, seed);
  const hearing = dayOf(daysAfter(at, 21 + (seed % 21)));
  return [
    "KALLELSE",
    criminal
      ? `Huvudförhandling hålls den ${hearing} kl. 09.30.`
      : `Muntlig förberedelse hålls den ${hearing} kl. 13.00.`,
    `Vittne: ${witness} ${pnr}`,
    criminal
      ? `Åklagare: Kammaråklagare ${pickFrom(PROSECUTORS, seed)}`
      : `Motpartens ombud: Advokat ${pickFrom(COUNSEL, seed)}`,
    "",
    `Frist för bevisuppgift: senast den ${dayOf(daysAfter(at, 10))}.`,
  ].join("\n");
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
  MYNDIGHET: "Beslut",
  FORSAKRING: "Försäkring",
  OVRIGT: "Övrigt",
};

/** Fördefinierade dokument-mallar (nyckel → mall). Utökas per scenariobehov. */
export const DOC_TEMPLATES: Record<string, DocTemplate> = {
  // Varje ärende får en kallelse: utan den stod Händelser och
  // Förslag tomma i de flesta ärenden.
  kallelse: {
    documentType: "Kallelse", direction: "INKOMMANDE", recipient: "DOMSTOL",
    title: "Kallelse från domstolen", summary: "Domstolen kallar till förhandling och förelägger parterna att inkomma med bevisuppgift.",
    subFolder: "Kallelser",
    body: kallelseBody,
  },
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
  // Kostnadsräkningens överklagandespår (#828 steg 6). Utan de här två ligger
  // ett ärende i BESLUTAD/ÖVERKLAGAD utan en enda handling som förklarar varför —
  // panelen visar en prutning och en pågående överklagan, akten är tom.
  arvodesbeslut: {
    documentType: "Beslut", direction: "INKOMMANDE", recipient: "DOMSTOL",
    title: "Beslut om ersättning till offentlig försvarare",
    summary: "Tingsrätten sätter ned det yrkade arvodet. Beslutet får överklagas särskilt.",
    subFolder: "Beslut",
  },
  overklagandeInlaga: {
    documentType: "Inlaga", direction: "UTGAENDE", recipient: "DOMSTOL",
    title: "Överklagande av arvodesbeslut",
    summary: "Överklagande till hovrätten av tingsrättens nedsättning av arvodet, med begäran om full ersättning.",
    subFolder: "Överklaganden",
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
