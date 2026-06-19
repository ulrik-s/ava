"use client";

/**
 * `StaticContentStore` (#545, ADR 0025) — `IContentStore` för demon utan server.
 * `read(storagePath)` hämtar den bundlade blobben (`<baseUrl>/<storagePath>`,
 * t.ex. `documents/content/doc-docx-12.docx`) som `build-demo` la i out/.
 *
 * Poängen: demon öppnar dokument via SAMMA väg som den riktiga klienten —
 * `loadDocumentBlob` → `document.downloadContent` → `ctx.ports.content.read` →
 * klientens IndexedDB-byte-cache (`DocumentContentCache.putBytes`). Andra
 * öppningen är en cache-hit (ingen fetch). Så demon bevisar byte-cache-vägen
 * (läs → cache → läs) med samma `IContentStore`-söm som `GitContentStore`
 * server-side — i st.f. `noopContentStore` (som ger `read → null` → dokumenten
 * gick aldrig att öppna i demon).
 *
 * `write` är no-op och `exists` görs billigt via en GET (GH Pages saknar HEAD-
 * stöd för statiska filer på ett pålitligt sätt) — demon laddar aldrig upp.
 */

import type { IContentStore } from "@/lib/server/ports";

export class StaticContentStore implements IContentStore {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private url(storagePath: string): string {
    return `${this.baseUrl}/${storagePath.replace(/^\/+/, "")}`;
  }

  async write(): Promise<void> {
    /* no-op: demon laddar aldrig upp bytes (ingen server). */
  }

  async read(storagePath: string): Promise<Uint8Array | null> {
    const res = await this.fetchFn(this.url(storagePath), { method: "GET", cache: "no-store" });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async exists(storagePath: string): Promise<boolean> {
    const res = await this.fetchFn(this.url(storagePath), { method: "GET", cache: "no-store" });
    return res.ok;
  }
}
