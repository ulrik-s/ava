/**
 * Konvertera råa bytes till base64 (för t.ex. helperns `compose-mail`-bilaga,
 * som tar `contentBase64`). Delad så fakturautskick (#179) och kostnadsräkning
 * inte duplicerar samma loop.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}
