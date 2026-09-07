#!/usr/bin/env bun
/**
 * HTTPS-server för Outlook-add-in:ens task-pane (#1077).
 *
 *   bun run addin:serve
 *
 * Office kräver HTTPS för `SourceLocation`. I **Outlook Web** laddas panelen av
 * BROWSERN, inte av Microsofts servrar — därför räcker `https://localhost:3443`
 * och ingen publik host behövs. (Central utrullning är en annan sak, se #1078:
 * där måste Microsoft själv kunna nå URL:en.)
 *
 * ## Varför certifikatet är hela poängen
 *
 * Office visar inte nätverksfel i panelen. Ett självsignerat cert som browsern
 * inte litar på ger en TOM panel utan felmeddelande — och då letar man efter
 * buggar i `taskpane-controller` i en timme. Därför kontrollerar scriptet
 * förtroendet och skriver ut exakt kommandot som fixar det.
 *
 * Certet är begränsat till localhost och lever i `.addin-tls/` (git-ignorerat).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.AVA_ADDIN_PORT ?? 3443);
// `import.meta.dir` är Bun-specifik och finns inte i TS-typerna (types: []).
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../office-addin/dist");
const TLS_DIR = resolve(HERE, "../../.addin-tls");
const CERT = join(TLS_DIR, "localhost.crt");
const KEY = join(TLS_DIR, "localhost.key");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

/**
 * Skapa cert + nyckel om de saknas. `openssl` i st.f. ett npm-paket: det finns
 * på varje utvecklarmaskin, och ett dev-cert är inte värt en ny dependency.
 *
 * `subjectAltName` är obligatorisk — moderna browsers ignorerar CN sedan länge
 * och ett cert utan SAN avvisas tyst.
 */
function ensureCert(): void {
  if (existsSync(CERT) && existsSync(KEY)) return;
  mkdirSync(TLS_DIR, { recursive: true });
  const r = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
    "-subj", "/CN=localhost/O=AVA add-in dev",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout", KEY, "-out", CERT,
  ], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("✗ openssl kunde inte skapa certifikatet.");
    process.exit(1);
  }
  console.log(`• Nytt dev-certifikat: ${CERT}`);
}

/** Litar systemet på certet? `null` = vet inte (annan plattform). */
function isTrusted(): boolean | null {
  if (process.platform !== "darwin") return null;
  const r = spawnSync("security", ["verify-cert", "-c", CERT], { stdio: "ignore" });
  return r.status === 0;
}

function trustHint(): void {
  const trusted = isTrusted();
  if (trusted === true) {
    console.log("• Certifikatet är betrott — panelen kommer att ladda.");
    return;
  }
  console.log("\n⚠ Certifikatet är INTE betrott ännu.");
  console.log("  Office visar inga nätverksfel: panelen blir TOM, utan förklaring.");
  console.log("  Kör det här en gång (frågar efter ditt lösenord):\n");
  console.log(`    security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ${CERT}\n`);
  if (trusted === null) {
    console.log("  (Icke-macOS: lita på certet i din browsers certifikatlager.)");
  }
}

/** Slå upp filen för en request-path. `null` = utanför roten eller saknas. */
export function fileFor(urlPath: string, root: string = ROOT): string | null {
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const rel = normalize(clean === "/" ? "/taskpane.html" : clean).replace(/^(\.\.[/\\])+/, "");
  const full = resolve(root, "." + rel);
  // Path traversal: `resolve` normaliserar, men bara en prefix-koll utesluter
  // att en request kan läsa utanför dist/.
  if (!full.startsWith(root)) return null;
  return existsSync(full) ? full : null;
}

function main(): void {
  if (!existsSync(join(ROOT, "taskpane.html"))) {
    console.error("✗ office-addin/dist saknas. Kör: bun run office-addin/build.ts");
    process.exit(2);
  }
  ensureCert();

  const server = createServer(
    { cert: readFileSync(CERT), key: readFileSync(KEY) },
    (req, res) => {
      const file = fileFor(req.url ?? "/");
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("finns inte");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        // Office cachar task-panen aggressivt. Utan detta testar man en gammal
        // bundle och tror att ändringen inte fick effekt.
        "cache-control": "no-store",
      }).end(readFileSync(file));
    },
  );

  server.listen(PORT, () => {
    console.log(`\n▸ Task-panen serveras: https://localhost:${PORT}/taskpane.html`);
    trustHint();
    console.log("\nSideload i Outlook Web (se office-addin/README.md för hela checklistan):");
    console.log("  1. https://aka.ms/olksideload");
    console.log("  2. Mina tillägg → Egna tillägg → Lägg till från fil");
    console.log("  3. office-addin/manifests/outlook-manifest.xml");
    console.log("\nCtrl-C för att stoppa.");
  });
}

// Bara när scriptet körs — `fileFor` ska gå att importera i test.
if (import.meta.main) main();
