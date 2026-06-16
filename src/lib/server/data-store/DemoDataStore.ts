/**
 * `DemoDataStore` — `IDataStore`-impl backad av in-memory data
 * (typiskt från `DemoRuntime` som klonat ett demo-repo från GitHub).
 *
 * Tunn subklass av [`LocalStore`](./in-memory/local-store.ts) — hela
 * den generiska in-memory-motorn (delegates, transaktioner, write-back)
 * bor numera där (#412), så att samma kärna kan återanvändas av den
 * persisterade offline-cachen (`createPersistedLocalStore`, ADR 0016).
 *
 * Konstruktorn är oförändrad:
 *   - `source` — en `DemoSource` (map entity → readonly array).
 *   - `onMutate?` — satt → writable (mutations + write-back); annars read-only.
 */

import { LocalStore } from "./in-memory/local-store";

// `DemoSource` bor i shared/ (delas av browser- + server-runtime).
// Re-exporteras så alla importörer av `@/lib/server/data-store/DemoDataStore`
// fungerar oförändrat.
export type { DemoSource } from "@/lib/shared/demo-source";

export class DemoDataStore extends LocalStore {}
