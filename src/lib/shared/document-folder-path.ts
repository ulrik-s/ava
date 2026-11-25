/**
 * Sökvägar i ett ärendes mappträd (#1974). Ramverksfri och generisk över
 * `{ id, name, parentId }`, så att listvyn, mappväljaren och senare flytten
 * till ett annat ärende räknar sökvägen på ett ställe.
 */

/** En mapp i trädet: id, namn och förälder (`null`/utelämnad = roten). */
export interface FolderNode<Id extends string = string> {
  id: Id;
  name: string;
  parentId?: Id | null | undefined;
}

/** Ett val i mappväljaren: mappens id och sökvägen som etikett. */
export interface FolderChoice<Id extends string = string> {
  id: Id;
  label: string;
}

/**
 * Mappnamnen från roten ned till `folderId` (`["Domstol", "Kallelse"]`).
 * En okänd mapp eller `null` ger `[]`.
 */
export function folderNamePath<Id extends string>(folderId: Id | null, folders: readonly FolderNode<Id>[]): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  const seen = new Set<Id>();
  let current = folderId === null ? undefined : byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts;
}

const SEPARATOR = " › ";

/**
 * Alla mappar i trädets ordning: förälder före barn, syskon på namn i svensk
 * ordning. Etiketten är sökvägen med " › " mellan nivåerna ("Domstol › Kallelse").
 */
export function folderChoices<Id extends string>(folders: readonly FolderNode<Id>[]): FolderChoice<Id>[] {
  const children = new Map<Id | null, FolderNode<Id>[]>();
  for (const f of folders) {
    const parent = f.parentId ?? null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const out: FolderChoice<Id>[] = [];
  const visit = (parent: Id | null, prefix: string): void => {
    const siblings = [...(children.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name, "sv"));
    for (const f of siblings) {
      const label = prefix + f.name;
      out.push({ id: f.id, label });
      visit(f.id, label + SEPARATOR);
    }
  };
  visit(null, "");
  return out;
}
