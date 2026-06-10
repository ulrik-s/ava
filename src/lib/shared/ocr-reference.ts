/**
 * Bankgiro-OCR-referens för kundfakturor (#182).
 *
 * En OCR-referens är helt numerisk och avslutas med en mod-10-kontrollsiffra
 * (Luhn). Vi använder Bankgirots "hårda" variant med längdsiffra: näst sista
 * siffran är (totala längden mod 10), sista är kontrollsiffran. Det är den
 * variant Bankgirots OCR-kontroll kan validera strikt (längd + checksiffra).
 *
 * Kärnan härleds ur fakturanumret `F-YYYY-NNNN` (#167) → `YYYYNNNN` (8
 * siffror) → + längdsiffra + kontrollsiffra = 10 siffror. Deterministisk:
 * samma faktura ger alltid samma OCR.
 *
 * VIKTIGT (domän): OCR genereras BARA för vanliga kundfakturor
 * (ACCONTO/FINAL). Kostnadsräkningar till domstol får INGEN OCR —
 * Domstolsverket betalar mot målnummer/ärendereferens i fri text (#173/#175).
 * Kreditfakturor betalas inte av kund → ingen OCR.
 */

/** Luhn/mod-10-kontrollsiffra för en siffersträng (utan kontrollsiffran). */
export function mod10CheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new Error(`mod10CheckDigit kräver enbart siffror, fick "${digits}"`);
  let sum = 0;
  // Luhn: vikta växelvis 2,1,2,… från höger (positionen närmast kontrollsiffran väger 2).
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    const weighted = i % 2 === 0 ? digit * 2 : digit;
    sum += weighted > 9 ? weighted - 9 : weighted;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Bygg en komplett OCR-referens ur en numerisk kärna: kärna + längdsiffra +
 * mod-10-kontrollsiffra. Längdsiffran = (total längd inkl. längd- och
 * kontrollsiffra) mod 10 — Bankgirots variant med längdkontroll.
 */
export function buildOcrReference(core: string): string {
  if (!/^\d+$/.test(core)) throw new Error(`OCR-kärnan måste vara numerisk, fick "${core}"`);
  const lengthDigit = (core.length + 2) % 10;
  const body = core + String(lengthDigit);
  return body + String(mod10CheckDigit(body));
}

/** Validera en OCR-referens (längdsiffra + mod-10-kontrollsiffra). */
export function isValidOcrReference(ocr: string): boolean {
  if (!/^\d{4,25}$/.test(ocr)) return false;
  const body = ocr.slice(0, -1);
  if (mod10CheckDigit(body) !== Number(ocr[ocr.length - 1])) return false;
  return Number(ocr[ocr.length - 2]) === ocr.length % 10;
}

/**
 * Härled OCR-referensen ur ett fakturanummer på formen `F-YYYY-NNNN` (#167):
 * sifferdelarna konkateneras (`YYYYNNNN`) och byggs på med längd- +
 * kontrollsiffra. Returnerar null för fakturor utan (parsbart) nummer —
 * t.ex. kostnadsräkningar till domstol, som inte ska ha OCR.
 */
export function ocrFromInvoiceNumber(invoiceNumber: string | null | undefined): string | null {
  if (!invoiceNumber) return null;
  const core = invoiceNumber.replace(/\D/g, "");
  if (core.length === 0) return null;
  return buildOcrReference(core);
}
