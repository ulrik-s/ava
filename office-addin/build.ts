/**
 * Bygg Outlook-tillägget: bundle (taskpane.js), HTML, ikoner, och per
 * installation config.js + manifest.xml (office-addin/manifest.ts).
 *
 *   bun office-addin/build.ts                    → office-addin/dist/ (lokalt, https://localhost:3443)
 *   bun office-addin/build.ts --out out/addin    → deployen: serveras på https://<AVA_DOMAIN>/addin/
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { addinBaseUrl, addinConfigFromEnv, manifestVersion, renderConfigJs, renderManifest } from "./manifest";

const root = import.meta.dir;
const outArg = process.argv.indexOf("--out");
const outdir = outArg > -1 && process.argv[outArg + 1] ? resolve(process.argv[outArg + 1] as string) : join(root, "dist");

const result = await Bun.build({
  entrypoints: [join(root, "taskpane/taskpane.ts")],
  outdir,
  target: "browser",
  minify: true,
  naming: "[dir]/taskpane.js",
});

if (!result.success) {
  console.error("✗ Bundle-bygget misslyckades:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await mkdir(outdir, { recursive: true });
await cp(join(root, "taskpane/taskpane.html"), join(outdir, "taskpane.html"));
await cp(join(root, "assets"), join(outdir, "assets"), { recursive: true });

const base = addinBaseUrl(process.env);
const config = addinConfigFromEnv(process.env);
await writeFile(join(outdir, "config.js"), renderConfigJs(config));
const template = await readFile(join(root, "manifests/outlook-manifest.xml"), "utf8");
await writeFile(join(outdir, "manifest.xml"), renderManifest(template, { base, version: manifestVersion(process.env) }));

console.log(`✓ Byggd → ${outdir}/ (taskpane.js, taskpane.html, config.js, manifest.xml, assets/) för ${base}.`);
if (!config) console.log("  OBS: OAUTH2_PROXY_CLIENT_ID/OIDC_ISSUER_URL saknas — tillägget visar \"inte konfigurerat\".");
