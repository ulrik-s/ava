/**
 * Skapar ärendets standardmappar (#1228) — idempotent per nivå: en mapp med
 * samma namn (skiftlägesokänsligt) under samma förälder återanvänds, så en
 * omkörning (backfill) bara fyller i det som saknas, även undermappar under en
 * befintlig "Domstol".
 *
 * Skriver via repona → change_log/versioner blir rätt och mapparna synkas till
 * klienterna precis som `document.createFolder` (som inte heller emittar events).
 */

import { DEFAULT_MATTER_FOLDERS, type DefaultFolderNode } from "@/lib/shared/default-matter-folders";
import type { DocumentFolder } from "@/lib/shared/schemas/document";
import { asId, type DocumentFolderId, type MatterId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";

/** Den del av repona hjälparen behöver. */
export type FolderRepos = Pick<Repositories, "documentFolders">;

interface FillCtx {
  repos: FolderRepos;
  matterId: MatterId;
  /** `<parentId>\0<namn i gemener>` → mapp-id. */
  index: Map<string, DocumentFolderId>;
  /** Id för en ny mapp ur dess nyckel (köat anrop, #1242), annars repots. */
  newId: ((key: string) => string) | undefined;
}

function folderKey(parentId: DocumentFolderId | null, name: string): string {
  return `${parentId ?? ""}\u0000${name.toLocaleLowerCase("sv")}`;
}

/** Befintlig mapp med nodens namn under `parentId`, annars en nyskapad. */
async function folderIdFor(
  ctx: FillCtx, node: DefaultFolderNode, parentId: DocumentFolderId | null,
): Promise<{ id: DocumentFolderId; created: number }> {
  const key = folderKey(parentId, node.name);
  const known = ctx.index.get(key);
  if (known !== undefined) return { id: known, created: 0 };
  const id = ctx.newId?.(`folder:${key}`);
  const folder = await ctx.repos.documentFolders.create(
    { ...(id ? { id: asId<"DocumentFolderId">(id) } : {}), name: node.name, matterId: ctx.matterId, parentId } satisfies Partial<DocumentFolder>,
  );
  ctx.index.set(key, folder.id);
  return { id: folder.id, created: 1 };
}

async function fillLevel(
  ctx: FillCtx, nodes: readonly DefaultFolderNode[], parentId: DocumentFolderId | null,
): Promise<number> {
  let created = 0;
  for (const node of nodes) {
    const folder = await folderIdFor(ctx, node, parentId);
    created += folder.created + (await fillLevel(ctx, node.children ?? [], folder.id));
  }
  return created;
}

/**
 * Säkerställ att ärendet har standardträdet. Returnerar antalet nyskapade
 * mappar (0 om allt redan fanns). `newId` ger nya mappar id ur deras plats i
 * trädet — i ett köat anrop (#1242) får klientens körning och serverns
 * omkörning då samma mappar.
 */
export async function ensureDefaultMatterFolders(
  repos: FolderRepos, matterId: MatterId, tree: readonly DefaultFolderNode[] = DEFAULT_MATTER_FOLDERS,
  newId?: (key: string) => string,
): Promise<number> {
  const existing = await repos.documentFolders.listByMatter(matterId);
  const index = new Map(existing.map((f) => [folderKey(f.parentId ?? null, f.name), f.id] as const));
  return fillLevel({ repos, matterId, index, newId }, tree, null);
}
