/**
 * `DemoRuntime` — composition root för **demo-läget** (Fas 4).
 *
 * Skiljer sig från `LocalRuntime` (Fas 3) genom att:
 *   - Det är **read-only** — UI:t kan läsa men inte skriva
 *   - Det finns ingen Prisma/SQLite — entiteterna lagras i Map<id, data>
 *     direkt i minnet, vilket är "good enough" för demo med <1000 ärenden
 *   - Det finns ingen sync — repo:t klonas en gång
 *
 * Use cases:
 *   - Säljare visar AVA utan att behöva server-setup
 *   - Utvecklare snabb-iterar UI mot deterministisk demo-data
 *   - Byråer "provkör" innan de bestämmer sig
 *
 * Designval (Single responsibility):
 *   - Det här är "demo-runtime". Den vet inte om regelmotor,
 *     event-log eller writes. Read path only.
 *
 * Designval (Liskov):
 *   - Returnerar `EntityCollection<T>` per entitet — samma interface
 *     UI-komponenter kan binda emot oavsett om data kommer från demo
 *     eller från en full IDataStore.
 *
 * Designval (DI):
 *   - `cloneFn` injiceras — produktion använder en wrapper kring
 *     `isomorphic-git.clone`; tester använder en fake.
 */

import { MemFs } from "./mem-fs";
import { DemoLoader, type DemoCloneFn, type LoadResult } from "./demo-loader";
import { buildDefaultRegistry } from "./projections/default-registry";

export type DemoStatus = "idle" | "loading" | "loaded" | "error";

export interface EntityCollection<T = unknown> {
  list(): T[];
  findById(id: string): T | null;
}

export interface DemoRuntimeDeps {
  cloneFn: DemoCloneFn;
}

export class DemoRuntime {
  private fs: MemFs;
  private loader: DemoLoader;
  private currentStatus: DemoStatus = "idle";

  private constructor(deps: DemoRuntimeDeps) {
    this.fs = new MemFs();
    this.loader = new DemoLoader({
      fs: this.fs,
      registry: buildDefaultRegistry(),
      cloneFn: deps.cloneFn,
    });
  }

  static create(deps: DemoRuntimeDeps): DemoRuntime {
    return new DemoRuntime(deps);
  }

  async loadDemo(url: string): Promise<LoadResult> {
    this.currentStatus = "loading";
    try {
      const result = await this.loader.loadDemo(url);
      this.currentStatus = "loaded";
      return result;
    } catch (err) {
      this.currentStatus = "error";
      throw err;
    }
  }

  status(): DemoStatus {
    return this.currentStatus;
  }

  isReadOnly(): boolean {
    return true;
  }

  // ── Entity-accessorer ──────────────────────────────────────────

  matters<T = unknown>(): EntityCollection<T> {
    return this.collectionFor<T>("matter");
  }

  contacts<T = unknown>(): EntityCollection<T> {
    return this.collectionFor<T>("contact");
  }

  users<T = unknown>(): EntityCollection<T> {
    return this.collectionFor<T>("user");
  }

  // ── private ───────────────────────────────────────────────────

  private collectionFor<T>(entity: string): EntityCollection<T> {
    const all = (this.loader.entities()[entity] ?? []) as T[];
    return {
      list: () => all,
      findById: (id: string) => {
        return all.find((item) => (item as { id?: string }).id === id) ?? null;
      },
    };
  }
}
