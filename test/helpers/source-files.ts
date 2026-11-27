/**
 * Gemensam filskanning för kontraktstester som läser källkoden (#1926).
 *
 * Spärrarna `classic-trpc-allowlist.test.ts` och `no-detail-link-regression.test.ts`
 * gick båda igenom en katalog rekursivt. Här finns den skanningen en gång, utan cast:
 * `Dirent.parentPath` är katalogen som posten ligger i.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Alla filer under `dir` (rekursivt) vars namn matchar `pattern`, som sökvägar från `dir`s bas. */
export function sourceFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}
