/**
 * Bygg Outlook task-pane-bundlen (#72, ADR 0013).
 *
 *   bun run office-addin/build.ts
 *
 * Producerar `office-addin/dist/taskpane.js` (+ kopierar taskpane.html). Servera
 * `dist/` över **HTTPS** (Office kräver det vid sideload — t.ex. en dev-cert à la
 * `helper-ui/src/engine/tls/`) och peka manifestets `SourceLocation` dit. Detta steg är
 * INTE CI-verifierbart (kräver Office-värd) → kör + sideload-testa lokalt.
 */

import { cp } from "node:fs/promises";
import { join } from "node:path";

const root = import.meta.dir;
const outdir = join(root, "dist");

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

await cp(join(root, "taskpane/taskpane.html"), join(outdir, "taskpane.html"));
// Ikonerna refereras av manifestets IconUrl. Saknas de visar Outlook en tom
// ruta — inte ett fel, men i en sideload-checklista är "är det trasigt eller
// ska det se ut så?" en fråga man inte ska behöva ställa.
await cp(join(root, "assets"), join(outdir, "assets"), { recursive: true });
console.log(`✓ Byggd → ${outdir}/ (taskpane.js + taskpane.html + assets/).`);
console.log("  Servera över HTTPS: bun run addin:serve");
