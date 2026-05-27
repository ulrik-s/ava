/**
 * `makeNodeGitWriteBack` — Node-motsvarigheten till appens self-hosted
 * writeBack (`src/lib/client/firma/fsa-write-back.ts`): skriver varje
 * skapad/uppdaterad entitet som JSON till en git-katalog på disk.
 *
 * Skriver `event.row` RAKT AV (som fsa-write-back gör) → identiskt
 * fil-innehåll oavsett om datan skapas i browsern eller av generatorn.
 * (Denormaliserade fält som `fileSize` bevaras — UI:t läser dem.)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";

export interface WriteBackEvent {
  entity: string;
  kind: string;
  row: Record<string, unknown>;
}

export function makeNodeGitWriteBack(outDir: string): (event: WriteBackEvent) => Promise<void> {
  return async (event: WriteBackEvent): Promise<void> => {
    if (event.kind === "delete") return; // generatorn skapar/uppdaterar bara

    // documentText: extraherad text, plain .txt (inte en registry-entitet)
    if (event.entity === "documentText") {
      const id = String(event.row.id);
      writeFile(join(outDir, `documents/text/${id}.txt`), String(event.row.text ?? ""));
      return;
    }

    const reg = ENTITY_REGISTRY[event.entity];
    if (!reg) return; // okänd entitet → hoppa (ingen git-path)
    writeFile(join(outDir, reg.gitPath(String(event.row.id), event.row)), JSON.stringify(event.row, null, 2) + "\n");
  };
}

function writeFile(full: string, content: string): void {
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
