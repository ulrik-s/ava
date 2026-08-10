/**
 * Mappstruktur för demons dokument (#985).
 *
 * Demon hade inga mappar alls: varje dokument låg i ärendets rot, så träd-vyns
 * hela poäng — mappar, drag-and-drop, nästling — gick varken att se eller prova.
 *
 * Filerna skapas av tre olika pass (den kronologiska simuleringen, faktura-
 * dokumenten och kostnadsräkningarna) som körs efter varandra och inte delar
 * state. Därför bor både SCHEMAT och "skapa-om-den-saknas"-logiken här, i st.f.
 * en kopia per pass som skulle hinna glida isär.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Nyckeln är `<matterId>/<sökväg>` — samma mappnamn i två ärenden är två mappar. */
export type FolderCache = Map<string, string>;

/** Ärenden vars befintliga mappar redan lästs in i cachen (en läsning per ärende). */
const HYDRATED = new WeakMap<FolderCache, Set<string>>();

interface ServerFolder { id: string; name: string; parentId: string | null }

/** Sökvägen till en mapp ("Domstol/Domar") genom att gå uppåt via parentId. */
function pathOf(folder: ServerFolder, byId: Map<string, ServerFolder>): string {
  const parts = [folder.name];
  let parent = folder.parentId === null ? undefined : byId.get(folder.parentId);
  while (parent) {
    parts.unshift(parent.name);
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
  }
  return parts.join("/");
}

/**
 * Läs in ärendets BEFINTLIGA mappar i cachen, en gång per ärende.
 *
 * Utan det här steget ser varje pass bara sina egna mappar: simuleringen skapade
 * "Domstol", kostnadsräkningspasset hittade den inte i sin egen cache och skapade
 * en ANDRA mapp med samma namn. Sex dubbletter i demodatat innan detta fanns.
 */
async function hydrate(caller: Any, matterId: string, cache: FolderCache): Promise<void> {
  const seen = HYDRATED.get(cache) ?? new Set<string>();
  HYDRATED.set(cache, seen);
  if (seen.has(matterId)) return;
  seen.add(matterId);
  const { folders } = await caller.document.tree({ matterId }) as { folders: ServerFolder[] };
  const byId = new Map(folders.map((f) => [f.id, f] as const));
  for (const f of folders) cache.set(`${matterId}/${pathOf(f, byId)}`, f.id);
}

/** Fakturadokumenten samlas för sig, oavsett vem fakturan ställts till. */
export const INVOICE_FOLDER = ["Fakturor"];

/** Kostnadsräkningen går till domstolen men förtjänar en egen hylla där. */
export const KOSTNADSRAKNING_FOLDER = ["Domstol", "Kostnadsräkningar"];

/**
 * Mapp-id:t för en sökväg i ett ärende — skapar de led som saknas, uppifrån och
 * ned. Cachen gör att en mapp skapas EN gång oavsett hur många dokument som
 * hamnar i den, även när anropen kommer utspridda över ett helt pass.
 *
 * Returnerar `null` för en tom sökväg (dokumentet hamnar i roten).
 */
export async function ensureFolderPath(
  caller: Any, matterId: string, path: readonly string[], cache: FolderCache,
): Promise<string | null> {
  if (path.length > 0) await hydrate(caller, matterId, cache);
  let parentId: string | null = null;
  let sofar = "";
  for (const name of path) {
    sofar = sofar ? `${sofar}/${name}` : name;
    const key = `${matterId}/${sofar}`;
    const known = cache.get(key);
    if (known !== undefined) { parentId = known; continue; }
    const folder = await caller.document.createFolder({ matterId, name, parentId }) as { id: string };
    cache.set(key, folder.id);
    parentId = folder.id;
  }
  return parentId;
}
