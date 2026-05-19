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

const baseConfig: NextConfig = {
  reactStrictMode: true,
};

const demoConfig: NextConfig = {
  ...baseConfig,
  output: "export",
  basePath: demoBasePath || undefined,
  assetPrefix: demoBasePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  // Vi behöver inte type-check eller lint igen i export-steget — CI
  // har redan kört dem och en lokal build ska gå snabbt.
  typescript: { ignoreBuildErrors: false },
};

const nextConfig: NextConfig = isDemoBuild ? demoConfig : baseConfig;

export default nextConfig;
