/**
 * PC8 / CP437-kodning för SIE-filer (#247, följd på #244).
 *
 * SIE 4 deklarerar `#FORMAT PC8` = IBM Code Page 437 (8-bitars). Vi genererar
 * SIE som vanlig JS-sträng (Unicode) i [[sie]]; den här modulen kodar strängen
 * till CP437-bytes vid OUTPUT-gränsen (nedladdning/skrivning) så åäöÅÄÖ m.fl.
 * tolkas rätt av strikta importörer i stället för att bli mojibake.
 *
 * ASCII (0x00–0x7F) är identiskt. 0x80–0xFF mappas via CP437:s övre halva.
 * Tecken som CP437 inte kan representera ersätts med '?' (0x3F) — synligt
 * tappat hellre än trasig fil.
 */

/**
 * CP437:s övre halva (byte 0x80–0xFF → Unicode). Kanonisk tabell; index 0
 * motsvarar byte 0x80. Innehåller bl.a. de svenska tecknen:
 * ü(0x81) é(0x82) ä(0x84) å(0x86) Ä(0x8E) Å(0x8F) ö(0x94) Ö(0x99) ü/Ü(0x9A) ß(0xE1).
 */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** Unicode-kodpunkt → CP437-byte (0x80–0xFF). Byggs en gång ur tabellen. */
const UNICODE_TO_CP437: ReadonlyMap<number, number> = new Map(
  [...CP437_HIGH].map((ch, i) => [ch.codePointAt(0) as number, 0x80 + i]),
);

const QUESTION_MARK = 0x3f;

/** Koda en sträng till CP437/PC8-bytes (ej-representerbart → '?'). */
export function encodePc8(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      out[i] = code;
    } else {
      out[i] = UNICODE_TO_CP437.get(code) ?? QUESTION_MARK;
    }
  }
  return out;
}
