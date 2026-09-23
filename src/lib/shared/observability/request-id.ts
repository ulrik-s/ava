/**
 * `request-id` — korrelations-id (#1080).
 *
 * Det här är fältet som gör skillnad mellan "något small i går" och en
 * felsökning. Användaren ser id:t i felrutan, läser upp det i telefon, och
 * varje loggpost för just det anropet går att hitta.
 *
 * ## Formen
 *
 * Kort och uppläsbart över telefon. En UUID (36 tecken, hex) är svår att läsa
 * fel men jobbig att diktera; det här är 12 tecken ur ett alfabet utan de
 * tecken som förväxlas i tal och skrift (0/O, 1/I/l). Kollisionsrisken spelar
 * ingen roll — id:t behöver bara vara unikt inom loggens retentionsfönster,
 * inte globalt för all framtid.
 *
 * Browser-safe: `crypto.getRandomValues` finns i både webbläsare och Node ≥ 19,
 * och det är samma runtime-krav som resten av appen redan har.
 */

/** Utan 0/O och 1/I/L — de förväxlas när någon läser upp id:t. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LENGTH = 12;

/**
 * Nytt korrelations-id.
 *
 * Modulo-bias: 256 % 31 ≠ 0, så råa byte-värden skulle gynna de första
 * tecknen i alfabetet en aning. Här kasseras värden i den ojämna svansen i
 * stället — id:t ska vara läsbart, men det finns ingen anledning att göra det
 * snedfördelat på köpet.
 */
export function newRequestId(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";
  const buf = new Uint8Array(LENGTH * 2);
  while (out.length < LENGTH) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === LENGTH) break;
    }
  }
  return out;
}

/** Headern en klient kan skicka för att knyta ihop sitt anrop med serverns logg. */
export const REQUEST_ID_HEADER = "x-ava-request-id";

/**
 * Id:t ur en inkommande request, eller ett nytt.
 *
 * Ett klient-satt id godtas bara om det ser ut som ett av våra. Annars kan
 * vem som helst sätta ett id som krockar med en annan användares — eller
 * smuggla in tecken som bryter loggraden när den läses som JSON.
 */
const SHAPE = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`);

export function requestIdFrom(headers: { get(name: string): string | null }): string {
  const given = headers.get(REQUEST_ID_HEADER);
  return given !== null && SHAPE.test(given) ? given : newRequestId();
}
