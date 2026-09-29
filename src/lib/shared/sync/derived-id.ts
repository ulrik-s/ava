/**
 * Härledda id:n för köade anrop (#1276, ADR 0037).
 *
 * Ett köat anrop körs två gånger: optimistiskt i klienten och auktoritativt på
 * servern. Rader som anropet skapar (en betalning, en tjänsteanteckning, …)
 * måste få SAMMA id båda gångerna, annars finns klientens rad kvar bredvid
 * serverns. Id:t härleds därför ur anropets id (`seed`, ett UUIDv7) och radens
 * roll i anropet (`"payment"`, `"serviceNote"`, `"row:3"`).
 *
 * Formen är ett UUIDv7: fröets 48-bitars tidsstämpel behålls (B-tree-lokalitet,
 * som för övriga id:n), resten är en 128-bitars hash av frö + roll. Hashen är
 * inte kryptografisk — den behöver bara sprida; fröet är redan slumpat.
 */

/** cyrb128 — fyra 32-bitars ord ur en sträng (spridning, inte säkerhet). */
function hash128(text: string): number[] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function hex32(n: number): string {
  return n.toString(16).padStart(8, "0");
}

/** Fröets tidsstämpel (de första 12 hex-tecknen), eller nollor om det inte är ett uuid. */
function timestampHex(seed: string): string {
  const ts = seed.replace(/-/g, "").slice(0, 12);
  return /^[0-9a-f]{12}$/i.test(ts) ? ts.toLowerCase() : "000000000000";
}

/** Samma `seed` + `role` → samma UUIDv7, i klienten och på servern. */
export function derivedId(seed: string, role: string): string {
  const rand = hash128(`${seed}\u0000${role}`).map(hex32).join("");
  const ts = timestampHex(seed);
  const variant = ((parseInt(rand.charAt(3), 16) & 0x3) | 0x8).toString(16);
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${rand.slice(0, 3)}-${variant}${rand.slice(4, 7)}-${rand.slice(7, 19)}`;
}
