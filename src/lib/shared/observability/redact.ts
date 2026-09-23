/**
 * `redact` — sista nätet innan text hamnar i en logg (#1080).
 *
 * ## Varför en advokatbyrå inte kan logga som andra
 *
 * En vanlig applikation loggar gärna indata för att kunna felsöka. Här är
 * indatat klientens personnummer, motpartens namn och vad tvisten gäller.
 * Advokatsekretessen gäller uppgiften om att någon ÄR klient — inte bara vad
 * klienten sagt. En logg som avslöjar att `19670312-4521` finns i systemet har
 * redan läckt det.
 *
 * ## Två lager, i den ordningen
 *
 * 1. **Strukturen** är första försvaret: en `LogRecord` bär bara deklarerade
 *    fält, aldrig en fri payload (se `logger.ts`). Det som inte skickas kan
 *    inte läcka.
 * 2. **`redactText`** är andra försvaret, för texten som ändå måste med —
 *    framför allt felmeddelanden. Ett `TRPCError` kan bära `Klienten Anna
 *    Andersson (19670312-4521) saknar ...` rakt ur en domänregel.
 *
 * Lager 2 är avsiktligt trubbigt. Det kan inte känna igen ett namn, och det
 * påstår inte att det kan. Det tar de former som GÅR att känna igen säkert och
 * maskerar dem. Att lita på lager 2 i stället för lager 1 vore fel väg runt.
 */

/** Ersättning som visar VAD som maskerades — en naken `***` gör felsökning omöjlig. */
const MASK = (what: string): string => `[${what} maskerat]`;

/**
 * Personnummer och samordningsnummer: `ÅÅÅÅMMDD-NNNN`, `ÅÅMMDD-NNNN`, med
 * bindestreck, plus eller inget alls. Organisationsnummer har samma form som
 * tiosiffrigt personnummer och fångas av samma mönster — det är avsiktligt,
 * en motparts orgnummer är lika identifierande.
 *
 * Ordgränserna hindrar att ett OCR-nummer eller ett långt id kapas mitt i.
 */
const PERSONNUMMER = /\b(?:\d{8}|\d{6})[-+]?\d{4}\b/g;

/** E-post. Identifierar en person lika säkert som personnumret. */
const EPOST = /\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/g;

/**
 * Bearer-token, refresh-token och API-nycklar. Dessa läcker inte sekretess
 * utan ÅTKOMST — en logg som råkat fångas i en supporttråd blir en nyckel.
 */
const BEARER = /\b[Bb]earer\s+[A-Za-z0-9._~+/-]+=*/g;
const HEX_TOKEN = /\b[0-9a-f]{32,}\b/g;

/** Telefonnummer, svenskt format. Svagare signal men samma sekretessklass. */
const TELEFON = /\b(?:\+46|0)\s?7[02369][\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g;

/**
 * Maskera det som säkert går att känna igen. Ordningen spelar roll: token-
 * mönstren körs FÖRE personnummer, annars kan en hex-token med tolv siffror i
 * rad få en bit maskerad som personnummer och resten lämnas i klartext.
 */
export function redactText(text: string): string {
  return text
    .replace(BEARER, MASK("token"))
    .replace(HEX_TOKEN, MASK("token"))
    .replace(EPOST, MASK("e-post"))
    .replace(PERSONNUMMER, MASK("personnummer"))
    .replace(TELEFON, MASK("telefon"));
}

/**
 * Maskera ett felmeddelande och korta det.
 *
 * Längdtaket är inte kosmetika: ett ovalidatat fel kan bära en hel
 * JSON-payload, och då är strukturskyddet (lager 1) verkningslöst eftersom
 * payloaden reser med som text i stället.
 */
const MAX_MESSAGE = 300;

export function redactMessage(message: string): string {
  const clean = redactText(message);
  return clean.length <= MAX_MESSAGE ? clean : `${clean.slice(0, MAX_MESSAGE)}…`;
}

/** Felets meddelande, maskerat. Icke-Error kastas ofta i JS — de hanteras här
 *  i stället för på varje anropsplats. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return redactMessage(err.message);
  if (typeof err === "string") return redactMessage(err);
  return "okänt fel";
}
