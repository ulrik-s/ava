/**
 * Tyst stub för Node-only moduler i browser-bundle:n.
 *
 * Returnerar en no-op-funktion som tål allt:
 *   - kallas som funktion → undefined
 *   - new:as → undefined
 *   - egenskaper läses → undefined (eller specifika kända default-värden)
 *
 * Detta tål alla mönster en lib kan göra vid modul-init:
 *   const fs = require("fs"); fs.readFileSync("..."); → undefined
 *   const { Buffer } = require("buffer"); → undefined
 *
 * Om koden FAKTISKT skulle försöka använda resultatet i prod-flöde
 * kraschar det vid runtime. Men i demo-läge anropas server-flöden
 * aldrig (allt går via DemoDataStore).
 */

function noop() { /* no-op */ }
noop.default = noop;

module.exports = noop;
module.exports.default = noop;
