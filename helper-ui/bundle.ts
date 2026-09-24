/**
 * Bygg `dist/main.cjs` med versionen inbakad (#1149).
 *
 * Utan `__AVA_HELPER_VERSION__` blir versionen "dev", och då jämförs den aldrig
 * mot GitHub-releaserna — uppdateringsnotisen (ADR 0030 §2) hittade aldrig
 * något. Versionen tas ur package.json så den bara finns på ett ställe.
 */

import pkg from "./package.json" with { type: "json" };

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  target: "node",
  format: "cjs",
  external: ["electron"],
  outdir: "dist",
  naming: "main.cjs",
  define: { __AVA_HELPER_VERSION__: JSON.stringify(`helper-v${pkg.version}`) },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`dist/main.cjs — helper-v${pkg.version}`);
