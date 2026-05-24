/**
 * `cloneFromGithub` — produktions-implementation av `DemoCloneFn` som
 * använder `isomorphic-git.clone` mot en HTTPS-url (typiskt GitHub).
 *
 * Använder `isomorphic-git/http/web` när vi kör i browser, och
 * `isomorphic-git/http/node` i Node-runtime (importeras dynamiskt så
 * vi inte bundlar fel transport).
 *
 * Designval (Single responsibility):
 *   - En tunn wrapper. Den vet bara hur man kallar `clone`. Den vet
 *     inget om DemoLoader, hydrate eller IDataStore.
 *
 * Designval (DI):
 *   - `httpFactory` är optional — default importerar rätt http-plugin
 *     baserat på runtime. Tester kan injicera en fake-http.
 */

import * as git from "isomorphic-git";
import type { MemFs } from "./mem-fs";
import type { DemoCloneFn } from "./demo-loader";

export interface CloneFromGithubOptions {
  /**
   * Branch/ref att klona. Default "main".
   */
  ref?: string;
  /**
   * Shallow clone — bara N senaste commits. Default 1 (för demo:n
   * räcker det med senaste snapshot).
   */
  depth?: number;
  /**
   * isomorphic-git http-plugin. Default importeras dynamiskt:
   *   - browser → `isomorphic-git/http/web`
   *   - node    → `isomorphic-git/http/node`
   */
  http?: { request: (opts: unknown) => Promise<unknown> };
  /**
   * CORS-proxy-url. Krävs i browser för att klona från github.com
   * (GitHub servar inte CORS-headers för smart-HTTP). I Node behövs
   * den inte.
   *
   * - Default i browser: `https://cors.isomorphic-git.org` (publik
   *   demo-proxy från isomorphic-git-teamet, för dev/demo).
   * - Sätt till `null` för att uttryckligen stänga av.
   * - För prod: kör en egen liten proxy (`@isomorphic-git/cors-proxy`)
   *   och peka hit.
   */
  corsProxy?: string | null;
}

/**
 * Bygg en `DemoCloneFn` med givna options. Returnerar en funktion
 * som matchar `DemoLoader.cloneFn`-signaturen.
 */
export function cloneFromGithub(options: CloneFromGithubOptions = {}): DemoCloneFn {
  const ref = options.ref ?? "main";
  const depth = options.depth ?? 1;

  return async function clone(fs: MemFs, url: string): Promise<void> {
    const http = options.http ?? (await defaultHttp());
    const corsProxy = resolveCorsProxy(options.corsProxy);
    await git.clone({
      fs: fs.nodeFs(),
      http: http as never,
      dir: "/",
      url,
      ref,
      singleBranch: true,
      depth,
      ...(corsProxy ? { corsProxy } : {}),
    });
  };
}

/**
 * I browser krävs en CORS-proxy mot github.com. I Node ignoreras
 * proxy:n. `null` = användaren har stängt av explicit.
 */
// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'resolveCorsProxy' has a complexity of 10. Maximum allowed is 8.)
function resolveCorsProxy(opt: string | null | undefined): string | null {
  if (opt === null) return null;
  if (opt) return opt;
  const isBrowser = typeof globalThis !== "undefined"
    && (globalThis as { window?: unknown }).window !== undefined;
  if (!isBrowser) return null;
  // 1. Build-time injicerad proxy (Cloudflare Worker i prod-deploy)
  const envProxy = process.env.NEXT_PUBLIC_CORS_PROXY_URL;
  if (envProxy) return envProxy;
  // 2. Dev-läge: lokal cors-proxy på 9999 (startas av `yarn dev`).
  const loc = (globalThis as { location?: { hostname?: string } }).location;
  const host = loc?.hostname ?? "";
  const isLocalDev = host === "localhost" || host === "127.0.0.1";
  if (isLocalDev) return "http://localhost:9999";
  // 3. Sista fallback: publika proxyn (driftsäker self-host rekommenderas).
  return "https://cors.isomorphic-git.org";
}

/**
 * Importera rätt http-plugin baserat på runtime. Lazy så vi inte
 * tvingar bundlern att inkludera båda.
 */
async function defaultHttp(): Promise<{ request: (opts: unknown) => Promise<unknown> }> {
  // Vi gör best-effort detection: om `globalThis.window` finns kör vi
  // i browser. Annars Node.
  if (typeof globalThis !== "undefined" && (globalThis as { window?: unknown }).window !== undefined) {
    const mod = await import("isomorphic-git/http/web");
    return mod.default as never;
  }
  const mod = await import("isomorphic-git/http/node");
  return mod.default as never;
}
