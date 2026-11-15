/**
 * Byta namn på ett dokument: bara visningsnamnet (`fileName`) ändras —
 * lagringssökvägen ligger kvar, så innehåll, länkar och historik påverkas inte.
 * Delas av servern (document.updateDetails) och dialogen (förhandsvisning).
 */

/** Längsta tillåtna filnamn (vanliga filsystem tar 255 byte). */
export const MAX_FILE_NAME = 200;

/** Filändelsen inklusive punkt (`.pdf`), eller tom sträng. */
export function fileExtension(name: string): string {
  const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
  return m ? m[0] : "";
}

/**
 * Det nya visningsnamnet, städat: inga sökvägstecken eller styrtecken, inga
 * blanksteg i ändarna, och originalets filändelse behålls om den togs bort
 * (annars öppnas filen i fel program). Tomt → null.
 */
export function cleanFileName(input: string, original: string): string | null {
  const base = input.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim();
  if (!base) return null;
  const ext = fileExtension(original);
  const withExt = ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base;
  return withExt.length > MAX_FILE_NAME ? `${withExt.slice(0, MAX_FILE_NAME - ext.length)}${ext}` : withExt;
}
