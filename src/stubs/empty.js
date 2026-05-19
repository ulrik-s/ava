/**
 * Tyst stub för Node-only moduler i browser-bundle:n.
 *
 * Returnerar en Proxy där varje access ger en no-op-funktion eller
 * tomt objekt. På så sätt kraschar inte modul-init när biblioteket
 * gör `const x = require("fs")` + `const { foo } = x` på top-level.
 *
 * Om kod faktiskt försöker köra en server-funktion → no-op.
 * Det är OK eftersom inget server-flöde anropas i demo (allt går
 * via DataStore).
 */

function makeProxy() {
  const fn = function noop() { return makeProxy(); };
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === "default") return makeProxy();
      if (prop === "then") return undefined; // undvik felaktig await-detection
      if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
      return makeProxy();
    },
    apply() { return makeProxy(); },
    construct() { return makeProxy(); },
  });
}

module.exports = makeProxy();
