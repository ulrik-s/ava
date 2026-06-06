/**
 * `user-colors` — deterministisk färgkodning per användar-ID för
 * multi-user-kalendervyn.
 *
 * Design:
 *   - Stabil per id (samma färg över page-reloads, sessioner).
 *   - Skiljbar mellan id:n inom rimliga byrå-storlekar (≤20 advokater).
 *   - Mörk nog för vit text (kontrast ≥ ~4.5:1) i chip-bakgrunder.
 *
 * Vi använder en handvald palett med ~12 distinkta nyanser, indexerad via
 * en stabil hash av id:t. Detta beats en HSL-from-hash som lätt ger
 * blandade-pasteller utan tydliga gränser.
 */

export interface UserColor {
  /** Bakgrund för chip/punkter — mörk nog för vit text. */
  bg: string;
  /** Lättare nyans för "selected"-bakgrunder. */
  bgLight: string;
  /** Border/accent. */
  border: string;
  /** Text-färg vid mörk bakgrund (alltid vit i nuvarande palett). */
  text: string;
}

/**
 * Palett av 12 distinkta CRM-färger. Ordnade så att första ~6 ger maximal
 * separation (för byråer med få användare).
 */
const PALETTE: readonly UserColor[] = [
  { bg: "#2563eb", bgLight: "#dbeafe", border: "#1d4ed8", text: "#ffffff" }, // blå
  { bg: "#dc2626", bgLight: "#fee2e2", border: "#b91c1c", text: "#ffffff" }, // röd
  { bg: "#059669", bgLight: "#d1fae5", border: "#047857", text: "#ffffff" }, // grön
  { bg: "#d97706", bgLight: "#fef3c7", border: "#b45309", text: "#ffffff" }, // orange
  { bg: "#7c3aed", bgLight: "#ede9fe", border: "#6d28d9", text: "#ffffff" }, // lila
  { bg: "#0891b2", bgLight: "#cffafe", border: "#0e7490", text: "#ffffff" }, // cyan
  { bg: "#db2777", bgLight: "#fce7f3", border: "#be185d", text: "#ffffff" }, // rosa
  { bg: "#65a30d", bgLight: "#ecfccb", border: "#4d7c0f", text: "#ffffff" }, // lime
  { bg: "#9333ea", bgLight: "#f3e8ff", border: "#7e22ce", text: "#ffffff" }, // violet
  { bg: "#0284c7", bgLight: "#e0f2fe", border: "#0369a1", text: "#ffffff" }, // sky
  { bg: "#ca8a04", bgLight: "#fef9c3", border: "#a16207", text: "#ffffff" }, // amber
  { bg: "#475569", bgLight: "#f1f5f9", border: "#334155", text: "#ffffff" }, // slate
];

/** Stabil hash av en sträng → icke-negativt heltal. FNV-1a 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function colorForUserId(userId: string): UserColor {
  if (!userId) return PALETTE[PALETTE.length - 1]!; // slate fallback
  return PALETTE[hashString(userId) % PALETTE.length]!;
}

/**
 * Bygg en `Map<userId, UserColor>` där färgerna är GARANTERAT unika för
 * upp till `paletteSize()` användare. Ordningen bestäms av sorterade
 * id:n så samma uppsättning ger samma map oavsett input-ordning.
 *
 * Vid >paletteSize användare cyklar paletten — kollisioner är då
 * oundvikliga men sker bara efter index ≥ PALETTE_SIZE. För typiska
 * advokatbyråer (≤12 användare i kalendervyn) blir det aldrig en
 * kollision.
 *
 * Detta är att föredra framför `colorForUserId` när du har hela listan
 * tillgänglig (UserPicker, CalendarPage) — eftersom hash-modulo kan
 * krocka även för få id:n.
 */
export function buildUserColorMap(userIds: readonly string[]): Map<string, UserColor> {
  const sorted = [...userIds].sort();
  const out = new Map<string, UserColor>();
  sorted.forEach((id, i) => out.set(id, PALETTE[i % PALETTE.length]!));
  return out;
}

/** För test/debug. */
export function paletteSize(): number {
  return PALETTE.length;
}
