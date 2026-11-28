/**
 * Dokumentmotorns textnormalisering (ADR 0042), flyttad ur fakturans gamla
 * renderare så att mallvägen ritar exakt samma tecken som fakturan alltid haft.
 */

/**
 * WinAnsi (pdf-lib:s standardkodning för StandardFonts) kan inte koda t.ex.
 * U+2212 MINUS SIGN eller typografiska citattecken — pdf-lib KASTAR då i st.f.
 * att ersätta. Vy-modellen använder "−" för avdrag, så texten måste tvättas.
 * Svenska å/ä/ö ligger i Latin-1 och klarar sig.
 */
const WIN_ANSI_SUBST: Record<string, string> = {
  "−": "-", "–": "-", "—": "-",
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "…": "...", " ": " ",
};

/** Text som pdf-libs standardteckensnitt (WinAnsi) kan koda — se ovan. */
export function toWinAnsi(s: string): string {
  return Array.from(s, (c) => WIN_ANSI_SUBST[c] ?? c)
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0;
      // 0x00–0x1F och 0x7F–0x9F är styrtecken utan glyf i WinAnsi.
      if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp > 0xff) return "?";
      return c;
    })
    .join("");
}
