/**
 * `makeNodeGitWriteBack` — en DataStore-writeBack som skriver varje skapad
 * entitet som ren JSON till en git-katalog på disk (Node fs).
 *
 * Demo-generatorn kör tRPC-mutationer mot en `DemoDataStore` med denna
 * writeBack → samma git-fillayout som appens self-hosted-writeBack, men i
 * Node istället för browser-FSA. `schema.parse` strippar ev. pre-bakade
 * joins från den enrichade raden → endast persisterade fält hamnar i filen.
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
    if (event.kind === "delete") return; // generatorn skapar bara

    // documentText: extraherad text, plain .txt (inte en registry-entitet)
    if (event.entity === "documentText") {
      const id = String(event.row.id);
      writeFile(join(outDir, `documents/text/${id}.txt`), String(event.row.text ?? ""));
      return;
    }

    const reg = ENTITY_REGISTRY[event.entity];
    if (!reg) return; // okänd entitet → hoppa (ingen git-path)
    // Schemas är `.passthrough()` (behåller extra fält) → parse strippar INTE
    // pre-bakade joins. Plocka istället bara schemats definierade fält.
    const clean = pickSchemaFields(reg.schema, event.row);
    writeFile(join(outDir, reg.gitPath(String(clean.id ?? event.row.id), clean)), JSON.stringify(clean, null, 2) + "\n");
  };
}

function pickSchemaFields(schema: unknown, row: Record<string, unknown>): Record<string, unknown> {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  if (!shape) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

function writeFile(full: string, content: string): void {
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
