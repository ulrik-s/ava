import type { NextConfig } from "next";

/**
 * Dual build target:
 *
 *   - DEMO_BUILD=1 → static export för GitHub Pages
 *     - `output: "export"` → producerar `out/` med ren statisk HTML/JS
 *     - `basePath` från `DEMO_BASE_PATH` (typiskt "/ava" eller "")
 *     - `images.unoptimized` (GH Pages har ingen image-loader)
 *
 *   - Annars → vanlig server-build (Vercel/Tauri/Self-hosted)
 *
 * API-routes och server-only-features måste exkluderas från demo-builden.
 * `scripts/build-demo.sh` flyttar `src/app/api/` åt sidan innan
 * `next build` så den statiska exporten inte försöker resolvera dem.
 */

const isDemoBuild = process.env.DEMO_BUILD === "1";
const demoBasePath = process.env.DEMO_BASE_PATH ?? "";

// Exponera basePath som NEXT_PUBLIC_*-variabel så client-bundle:n vet
// vad den ska prefixa absoluta URL:s med (t.ex. manifest.json).
process.env.NEXT_PUBLIC_DEMO_BASE_PATH = demoBasePath;

const baseConfig: NextConfig = {
  reactStrictMode: true,
};

/**
 * I demo-builden importerar `DemoBootstrap` → `appRouter`, vilket drar
 * in routrarnas transitive deps i client-bundle:n. Vi alias:ar Node-
 * only-moduler + server-only npm-paket till en tom stub så bundle:n
 * kompilerar. Server-only-funktioner körs aldrig i demo (allt går
 * via DemoDataStore som är read-only), så stubbarna anropas aldrig.
 */
const NODE_STUB = "./src/shared/stubs/empty.js";
const stubAliases: Record<string, { browser: string }> = {};
// Bara strikt Node-only-moduler som inte har browser-polyfill. Generiska
// paket (buffer, stream, crypto, util, url) har webpack-polyfills som
// browsern behöver — får INTE stubbas.
const NODE_BUILTINS_AND_SERVER_DEPS = [
  "fs", "fs/promises", "node:fs", "node:fs/promises",
  "dns", "node:dns",
  "net", "node:net",
  "tls", "node:tls",
  "child_process", "node:child_process",
  "os", "node:os",
  "zlib", "node:zlib",
  "nodemailer",
  "pg", "pg-connection-string", "pgpass", "pg-types",
  "@prisma/adapter-pg",
  "isomorphic-git/http/node",
];
for (const m of NODE_BUILTINS_AND_SERVER_DEPS) {
  stubAliases[m] = { browser: NODE_STUB };
}

const demoConfig: NextConfig = {
  ...baseConfig,
  output: "export",
  basePath: demoBasePath || undefined,
  assetPrefix: demoBasePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  turbopack: {
    resolveAlias: stubAliases,
  },
};

const nextConfig: NextConfig = isDemoBuild ? demoConfig : baseConfig;

export default nextConfig;
