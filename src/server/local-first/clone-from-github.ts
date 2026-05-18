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
    await git.clone({
      fs: fs.nodeFs(),
      http: http as never,
      dir: "/",
      url,
      ref,
      singleBranch: true,
      depth,
    });
  };
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
