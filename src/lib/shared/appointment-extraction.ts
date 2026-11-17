/**
 * Förordnanden ur ett dokuments TEXT (#1648).
 *
 * Ett förordnande ("Tingsrätten förordnar advokaten X som offentlig försvarare
 * för Y, ÅÅMMDD-NNNN.") säger vem advokaten företräder. Meningen slutar med
 * punkt och hoppas därför över av partsraderna i `document-extraction.ts`
 * (`SENTENCE_END`). Här läses den i stället som en hel mening.
 *
 * Samma försiktighet som i partsextraktionen: kräver verbet `förordna(r|s|des|ts|t)`,
 * orden `som <uppdrag> för <namn>` och namn med versal. Annars inget förordnande,
 * och partsförslagen blir exakt som utan den här modulen.
 */

/** Ett förordnande i texten. */
export interface Appointment {
  /** Den som förordnas (advokaten), med ev. titel ("advokaten") bortskalad. */
  appointee: string;
  /** Uppdraget, t.ex. "offentlig försvarare" eller "målsägandebiträde". */
  assignment: string;
  /** Den som uppdraget gäller ("för Y"). */
  client: string;
  /** Resten av meningen efter klientens namn — där personnumret brukar stå. */
  tail: string;
  /** Hela meningen, som motivering för den som ska godkänna förslaget. */
  sentence: string;
}

/** Ett namn: ett till fyra ord med versal i början, på en och samma rad. */
const NAME = String.raw`\p{Lu}[\p{L}'-]*(?: \p{Lu}[\p{L}'-]*){0,3}`;
/**
 * Ordgräns inne i meningen fram till klientens namn: ett mellanslag eller EN
 * radbrytning. En tom rad (två radbrytningar) avslutar meningen.
 */
const S = String.raw`[ \n]`;
const VERB = String.raw`förordna(?:r|s|des|ts|t)\b`;
/**
 * `som <uppdrag> för [den tilltalade] <namn><resten av meningen>`. Namnet och
 * resten stannar vid radslutet: utdragen PDF-text saknar ofta punkten, och
 * nästa rad är då en partsrad med någon annans namn och personnummer.
 */
const ASSIGNMENT = String.raw`som${S}(?<assignment>\p{Ll}+(?:${S}\p{Ll}+)*?)${S}för${S}(?:\p{Ll}+${S}){0,2}(?<client>${NAME})(?<tail>[^.\n]*)`;

/** "… förordnar advokaten X som …". */
const ACTIVE = new RegExp(String.raw`${VERB}${S}(?:[\p{Ll}.]+${S}){0,2}(?<appointee>${NAME})${S}${ASSIGNMENT}`, "gu");
/** "X förordnas som …", "Advokaten X har förordnats som …". */
const PASSIVE = new RegExp(String.raw`(?<appointee>${NAME})${S}(?:har${S})?${VERB}${S}(?:\p{Ll}+${S}){0,2}?${ASSIGNMENT}`, "gu");

/** Titeln före en advokats namn, så "Advokat X" och "advokaten X" blir samma. */
const TITLE = /^(?:advokat(?:en)?|biträdande jurist(?:en)?|jur\.? ?kand\.?) /i;

/** Jämförelsenyckel för ett namn: utan titel, gemener, enkla mellanslag. */
export function nameKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().replace(TITLE, "").toLowerCase();
}

/** Radbrytningar inne i meningen blir mellanslag. */
function oneLine(text: string): string {
  return text.replace(/\n/g, " ");
}

function toAppointment(match: RegExpExecArray): { at: number; appointment: Appointment } {
  const g = match.groups ?? {};
  return {
    at: match.index,
    appointment: {
      appointee: (g.appointee ?? "").replace(TITLE, ""),
      assignment: oneLine(g.assignment ?? ""),
      client: g.client ?? "",
      tail: g.tail ?? "",
      sentence: oneLine(match[0]),
    },
  };
}

/**
 * Förordnandena i texten, i den ordning de står. Det första är advokatens eget
 * uppdrag; resten är andra förordnanden i samma mål.
 */
export function findAppointments(text: string): Appointment[] {
  // Mellanslag slås ihop, men radbrytningarna behålls: de avgränsar namnet.
  const flat = text.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n");
  return [...flat.matchAll(ACTIVE), ...flat.matchAll(PASSIVE)]
    .map(toAppointment)
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.appointment);
}
