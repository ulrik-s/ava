/**
 * Extraktion av parter och händelser ur ett dokuments TEXT (#988).
 *
 * ## Varför den här finns
 *
 * `SuggestionsPanel` och `EventsPanel` fanns fullt utbyggda — med accept/reject
 * per förslag och per grupp — men stod tomma i ALLA tier. Ingenting skapade
 * raderna: `IDocumentAnalyzer.analyze` lovade i sin doc-kommentar att
 * "eventuella suggestions postas via dataStore.documentAnalysisSuggestions",
 * men classify-pipelinen skrev bara `document.updateMetadata`. Repositories,
 * routrar, relations och Postgres-tabeller underhölls för data som aldrig uppstod.
 *
 * ## Varför heuristik och inte LLM
 *
 * ADR 0027 gör LLM till en SERVER-förmåga, och demon har ingen server. En
 * LLM-baserad extraktion hade alltså lämnat panelerna tomma just där de syns
 * mest, och gjort testerna beroende av en modell. Mönstren nedan är i stället
 * rent deterministiska: samma text ger alltid samma förslag, i alla tier, och
 * går att testa på exakta strängar.
 *
 * Heuristiken är medvetet FÖRSIKTIG. Ett förslag är inte ett faktum — det är en
 * rad någon ska godkänna eller avfärda med ett klick. Falska positiver kostar
 * ett avfärdande; falska negativer kostar bara det man redan har i dag (inget
 * förslag alls). Därför krävs en tydlig markör — ett rollord, ett personnummer,
 * ett kallelseord — och gissas aldrig fritt ur löptext.
 */

import type { ContactType, MatterRole } from "./schemas/enums";

// ─── Parter ───────────────────────────────────────────────────────────────

/** Ett kontaktförslag ur dokumenttexten — fälten `DocumentAnalysisSuggestion` bär. */
export interface PartyCandidate {
  name: string;
  role: MatterRole;
  contactType: ContactType;
  personalNumber: string | null;
  orgNumber: string | null;
  /** Varför förslaget kom — visas för den som ska godkänna det. */
  notes: string;
}

/**
 * Rollord → roll. Ordningen spelar roll: mer specifika uttryck först, så
 * "Motpartens ombud" inte fastnar på "Motpart".
 */
const ROLE_MARKERS: ReadonlyArray<readonly [RegExp, MatterRole]> = [
  [/motpartens ombud|motpartsombud|ombud för motparten/i, "MOTPARTSOMBUD"],
  [/\bombud\b|\bbiträde\b/i, "OMBUD"],
  [/\bmotpart(en)?\b|\bsvarande(n)?\b/i, "MOTPART"],
  [/\bkärande(n)?\b|\bmålsägande(n)?\b|\bklient(en)?\b|\btilltalad(e|en)?\b/i, "KLIENT"],
  [/\båklagare(n)?\b/i, "AKLAGARE"],
  [/\bvittne(t|n)?\b/i, "VITTNE"],
  [/tingsrätt|hovrätt|högsta domstolen|förvaltningsrätt|kammarrätt/i, "DOMSTOL"],
  [/försäkringsbolag|försäkringsaktiebolag/i, "FORSAKRINGSBOLAG"],
];

/** Bolagsformer → contactType COMPANY. Svenska suffix, inte namnlistor. */
const COMPANY_SUFFIX = /\b(AB|HB|KB|aktiebolag|ekonomisk förening|stiftelse)\b\.?$/i;

/**
 * Personnummer respektive organisationsnummer, båda `NNNNNN-NNNN`.
 *
 * Skiljelinjen är TREDJE siffran: i ett personnummer är siffra 3–4 månaden
 * (01–12), så siffra 3 är 0 eller 1. Ett organisationsnummer har alltid ≥ 2 där.
 * Det är den officiella regeln och gör grupperna disjunkta utan checksumma.
 */
const PERSONAL_NUMBER = /\b(?:\d{2})?(\d{2}[01]\d{3})[-+](\d{4})\b/;
const ORG_NUMBER = /\b(\d{2}[2-9]\d{3})-(\d{4})\b/;

/** Rad + närmast föregående rad — rollordet står ofta på raden före namnet. */
interface Line { text: string; prev: string }

function toLines(text: string): Line[] {
  const raw = text.split(/\r?\n/).map((l) => l.trim());
  return raw.map((text, i) => ({ text, prev: raw[i - 1] ?? "" })).filter((l) => l.text.length > 0);
}

/** Meningsslut → raden är löptext, inte en partsrad. Partsblock skrivs
 *  `Roll: Namn`, utan punkt. */
const SENTENCE_END = /[.!?]$/;

function markerIn(text: string): MatterRole | null {
  for (const [pattern, role] of ROLE_MARKERS) {
    if (pattern.test(text)) return role;
  }
  return null;
}

/**
 * Rollen raden bär. Radens EGEN markör vinner alltid; först när den saknas
 * ärvs raden ovanför.
 *
 * Båda begränsningarna är nödvändiga. Utan "egen vinner" fick
 * "Svarande: Byggfirma Stenhammar AB" rollen OMBUD, eftersom raden ovanför var
 * "Ombud: Advokat Erik Lundqvist". Utan kravet att den ärvande raden ser ut som
 * ett ensamt namn ärvde varje mening i stycket föregående rads roll.
 */
function roleOf(line: Line): MatterRole | null {
  const own = markerIn(line.text);
  if (own) return own;
  if (SENTENCE_END.test(line.text)) return null;
  return markerIn(line.prev);
}

/**
 * Namnet på raden: allt före ett ev. personnummer/organisationsnummer, med
 * rollordet och skiljetecken bortskalade. Tom sträng → raden bär inget namn.
 */
function nameOf(line: string): string {
  return line
    .replace(PERSONAL_NUMBER, "").replace(ORG_NUMBER, "")
    .replace(/^[^:]{0,30}:\s*/, "")     // "Kärande: Anna Andersson"
    .replace(/[,;.\s]+$/, "")
    .trim();
}

function contactTypeFor(role: MatterRole, name: string): ContactType {
  if (COMPANY_SUFFIX.test(name)) return "COMPANY";
  if (role === "DOMSTOL") return "COURT";
  if (role === "FORSAKRINGSBOLAG") return "INSURANCE_COMPANY";
  if (role === "MOTPARTSOMBUD" || role === "OMBUD") return "LAW_FIRM";
  if (role === "AKLAGARE") return "AUTHORITY";
  return "PERSON";
}

/**
 * Raden är BARA ett rollord ("Svarande") → en rubrik för raden under, inte en
 * part. Testas genom att stryka markören: blir inget kvar var raden en etikett.
 * "Stockholms tingsrätt" behåller "Stockholms" och är alltså ett namn.
 */
function isBareRoleHeader(text: string): boolean {
  for (const [pattern] of ROLE_MARKERS) {
    if (pattern.test(text)) return !/\p{L}/u.test(text.replace(pattern, " ").replace(/[:\s]/g, ""));
  }
  return false;
}

/** Rimligt personnamn/bolagsnamn: 2–80 tecken, minst en bokstav, inte en mening. */
function isPlausibleName(name: string): boolean {
  if (name.length < 2 || name.length > 80) return false;
  if (!/\p{L}/u.test(name)) return false;
  return name.split(/\s+/).length <= 6;
}

/** `NNNNNN-NNNN` ur en träff, normaliserat till tio siffror med bindestreck. */
function joined(match: RegExpMatchArray | null): string | null {
  return match ? `${match[1]}-${match[2]}` : null;
}

/**
 * Kontaktförslag ur dokumenttexten.
 *
 * En rad ger ett förslag när den bär BÅDE en rollmarkör och ett rimligt namn.
 * Dubbletter (samma namn + roll) slås ihop — samma part nämns ofta flera gånger
 * i samma handling.
 */
export function extractPartySuggestions(text: string): PartyCandidate[] {
  const out = new Map<string, PartyCandidate>();
  for (const line of toLines(text)) {
    // Rader som slutar som en mening är löptext. "Käranden yrkar ersättning."
    // bär ett rollord men är inget partsnamn — utan den här grinden blev varje
    // sådan mening ett förslag att avfärda.
    if (SENTENCE_END.test(line.text)) continue;
    if (isBareRoleHeader(line.text)) continue;
    const role = roleOf(line);
    if (!role) continue;
    const name = nameOf(line.text);
    if (!isPlausibleName(name)) continue;
    const personalNumber = joined(line.text.match(PERSONAL_NUMBER));
    const orgNumber = joined(line.text.match(ORG_NUMBER));
    const key = `${name.toLowerCase()}|${role}`;
    if (out.has(key)) continue;
    out.set(key, {
      name, role, contactType: contactTypeFor(role, name),
      personalNumber, orgNumber,
      notes: `Föreslagen ur dokumentet: "${line.text.slice(0, 120)}"`,
    });
  }
  return [...out.values()];
}

// ─── Händelser ────────────────────────────────────────────────────────────

/** Ett händelseförslag — fälten `MatterEventSuggestion` bär. */
export interface EventCandidate {
  title: string;
  startAt: Date;
  eventType: string;
  description: string;
}

/** Kallelseord → händelsetyp. Utan ett sådant ord skapas inget förslag. */
const EVENT_MARKERS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/huvudförhandling/i, "Huvudförhandling", "HUVUDFORHANDLING"],
  [/muntlig förberedelse/i, "Muntlig förberedelse", "FORBEREDELSE"],
  [/häktningsförhandling/i, "Häktningsförhandling", "FORHANDLING"],
  [/sammanträde/i, "Sammanträde", "SAMMANTRADE"],
  [/förhör/i, "Förhör", "FORHOR"],
  [/\bfrist\b|senast den/i, "Frist", "FRIST"],
];

const MONTHS: Readonly<Record<string, number>> = {
  januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5,
  juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11,
};

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const SV_DATE = new RegExp(String.raw`\b(\d{1,2})\s+(${Object.keys(MONTHS).join("|")})\s+(\d{4})\b`, "i");
/** "kl. 09.00", "kl 09:00", "09.00". Minuterna är valfria. */
const TIME = /\bkl\.?\s*(\d{1,2})[.:](\d{2})\b/i;

/** Datumet på raden, om något — ISO först, annars svensk längdform. */
function dateOf(line: string): { y: number; m: number; d: number } | null {
  const iso = line.match(ISO_DATE);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]) - 1, d: Number(iso[3]) };
  const sv = line.match(SV_DATE);
  if (!sv) return null;
  const month = MONTHS[sv[2]!.toLowerCase()];
  return month === undefined ? null : { y: Number(sv[3]), m: month, d: Number(sv[1]) };
}

/**
 * Händelseförslag ur dokumenttexten.
 *
 * Kräver BÅDE ett kallelseord och ett datum på samma rad (eller raden före).
 * Klockslag är valfritt — en kallelse utan tid är fortfarande en kallelse, och
 * händelsen läggs då kl 00.00 för den som ska bekräfta den.
 */
export function extractEventSuggestions(text: string): EventCandidate[] {
  const out = new Map<string, EventCandidate>();
  for (const line of toLines(text)) {
    const hit = eventOn(line);
    if (hit && !out.has(hit.key)) out.set(hit.key, hit.event);
  }
  return [...out.values()];
}

/** Datum + ev. klockslag → tidpunkt. Utan tid läggs händelsen kl 00.00. */
function startAtOf(d: { y: number; m: number; d: number }, time: RegExpMatchArray | null): Date {
  return new Date(d.y, d.m, d.d, time ? Number(time[1]) : 0, time ? Number(time[2]) : 0, 0, 0);
}

/** Händelsen raden bär, eller null. Utbruten så `extractEventSuggestions` håller
 *  komplexitet ≤ 8. */
function eventOn(line: Line): { key: string; event: EventCandidate } | null {
  const marker = EVENT_MARKERS.find(([p]) => p.test(`${line.prev}\n${line.text}`));
  if (!marker) return null;
  const date = dateOf(line.text) ?? dateOf(line.prev);
  if (!date) return null;
  const startAt = startAtOf(date, line.text.match(TIME) ?? line.prev.match(TIME));
  if (Number.isNaN(startAt.getTime())) return null;
  return {
    key: `${marker[1]}|${startAt.toISOString()}`,
    event: {
      title: marker[1], startAt, eventType: marker[2],
      description: `Föreslagen ur dokumentet: "${line.text.slice(0, 120)}"`,
    },
  };
}
