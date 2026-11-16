/**
 * Ämnesraden ur ett mejl som `.eml` (#1616): namnrutan förifylls med den när
 * ett mejl släpps i dokumentvyn. Ren modul som delas av klient och server,
 * utan beroenden — samma sort som `document-file-name.ts`.
 *
 * Bara RFC 5322-huvudet läses (före första tomma raden), och bara de första
 * {@link EML_HEAD_BYTES} byten. Vikta rader och RFC 2047 encoded-words
 * (`=?UTF-8?B?…?=`, `=?ISO-8859-1?Q?…?=`) hanteras. Funktionen kastar aldrig.
 */

/** Hur många byte i början av mejlet som läses för att hitta huvudet. */
export const EML_HEAD_BYTES = 64 * 1024;

/** Är filen ett mejl (`.eml` eller `message/rfc822`)? */
export function isEmlFile(fileName: string, mimeType: string): boolean {
  return fileName.toLowerCase().endsWith(".eml") || mimeType.toLowerCase() === "message/rfc822";
}

/**
 * Huvudets byte som text: UTF-8 om det går (RFC 6532), annars Windows-1252.
 * `stream` gör att ett tecken som klippts av vid byte-gränsen inte räknas som fel.
 */
function decodeHead(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** En binärsträng (ett tecken per byte) som byte. */
function binaryToBytes(binary: string): Uint8Array {
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Q-kodning: `_` är blanksteg och `=XX` är en byte. */
function decodeQ(text: string): Uint8Array {
  return binaryToBytes(
    text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
  );
}

/** Ett encoded-word avkodat, eller det råa ordet om kodningen är trasig. */
function decodeWord(word: string, charset: string, encoding: string, text: string): string {
  try {
    const bytes = encoding.toUpperCase() === "B" ? binaryToBytes(atob(text)) : decodeQ(text);
    // RFC 2231 kan lägga till språk efter `*` (`UTF-8*sv`).
    const label = charset.split("*")[0] ?? charset;
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return word;
  }
}

/** Avkodar alla encoded-words; blanksteg mellan två intilliggande ord tas bort. */
function decodeEncodedWords(value: string): string {
  return value
    .replace(/(\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g, decodeWord);
}

/** Ämnet ur huvudtexten, eller null om det saknas eller är tomt. */
function subjectFromHeaderText(text: string): string | null {
  const header = text.split(/\r?\n\r?\n/)[0] ?? "";
  const unfolded = header.replace(/\r?\n(?=[ \t])/g, "");
  const match = /^subject:(.*)$/im.exec(unfolded);
  if (!match) return null;
  const subject = decodeEncodedWords(match[1] ?? "").replace(/\s+/g, " ").trim();
  return subject || null;
}

/**
 * Ämnesraden ur början av en `.eml`, avkodad. `null` om huvudet saknas, är
 * tomt eller inte går att tolka. Kastar aldrig.
 */
export function emlSubject(head: Uint8Array): string | null {
  return subjectFromHeaderText(decodeHead(head.subarray(0, EML_HEAD_BYTES)));
}
