/**
 * `resetDemoCompletely` — fullständig from-scratch-rensning av demo-läget.
 *
 * "Återställ demo"-knappen ska ge en *ren* demo, inte bara tömma den
 * aktuella slab-snapshotten. Annars blir det "rester av gammal data".
 * Vi rensar därför ALLA persistens-lager som kan överleva en reset:
 *
 *   1. OPFS demo-slab-snapshot(s) — alla `ava-demo*`-filer (även gamla
 *      versioner; lokalt är cache-nyckeln stabil men en deploy/version-
 *      växling kan ha lämnat orphan-snapshots).
 *   2. OPFS self-hosted working-copy — `working-copy`-katalogen. En kvar-
 *      lämnad sådan + dess `repo-root`-handle gör att demo-skrivningar
 *      mis-routas till FSA istället för slaben (writeBack → writeViaFsa i
 *      `demo-bootstrap`), vilket ser ut som att ändringar "försvinner".
 *   3. FSA-handeln `repo-root` i IndexedDB (`ava-fsa`).
 *   4. `ava.*`-localStorage/sessionStorage — stale config (oauthConfig,
 *      authSettings, llm, outlookToken m.fl.). `ava.firma` skrivs DÄREFTER
 *      tillbaka till demo-default — annars faller localhost till
 *      self-hosted-defaulten och knappen skulle kicka ut dig ur demon.
 *      `principalId` bevaras så man förblir inloggad.
 *
 * Best-effort: varje steg sväljer sina egna fel så att reset alltid kan
 * följas av en `window.location.reload()` (där `DemoBootstrap` då inte
 * hittar någon snapshot → klonar färsk seed-data).
 */

import { loadFirmaConfig, saveFirmaConfig, demoConfig } from "@/lib/client/firma/firma-config";

const DEMO_SNAPSHOT_PREFIX = "ava-demo";
const WORKING_COPY_DIR = "working-copy";
const LS_PREFIX = "ava.";

/** Minimal vy av OPFS-roten — bara det reset:en behöver (jfr persistence.ts). */
interface OpfsRootHandle {
  keys(): AsyncIterableIterator<string>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface NavigatorWithStorage {
  storage?: { getDirectory?: () => Promise<OpfsRootHandle> };
}

/** OPFS-roten, eller null om OPFS saknas/inte går att öppna. */
async function opfsRoot(): Promise<OpfsRootHandle | null> {
  const nav = (globalThis as unknown as { navigator?: NavigatorWithStorage }).navigator;
  if (!nav?.storage?.getDirectory) return null;
  try {
    return await nav.storage.getDirectory();
  } catch {
    return null;
  }
}

/** Toppnivå-namn i OPFS-roten, eller [] om de inte kan listas. */
async function opfsNames(root: OpfsRootHandle): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const name of root.keys()) names.push(name);
  } catch {
    /* ingen iterator → äldre/oväntad OPFS-impl */
  }
  return names;
}

function isDemoArtifact(name: string): boolean {
  return name.startsWith(DEMO_SNAPSHOT_PREFIX) || name === WORKING_COPY_DIR;
}

/** Radera demo-slab-snapshots + ev. self-hosted working-copy ur OPFS-roten. */
async function clearOpfsArtifacts(): Promise<void> {
  const root = await opfsRoot();
  if (!root) return;
  for (const name of await opfsNames(root)) {
    if (isDemoArtifact(name)) {
      await root.removeEntry(name, { recursive: true }).catch(() => {});
    }
  }
}

/** Radera den persisterade FSA-handeln så demo-skrivningar går till slaben. */
async function clearFsaHandle(): Promise<void> {
  try {
    const { deleteHandle } = await import("@/lib/client/fsa/handle-store");
    await deleteHandle("repo-root");
  } catch {
    /* IndexedDB saknas/fel → ingen handle att rensa */
  }
}

/** Ta bort alla `ava.*`-nycklar ur en Storage (samlar först, raderar sen). */
function clearAvaStorage(store: Storage | undefined): void {
  if (!store) return;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(LS_PREFIX)) keys.push(k);
  }
  for (const k of keys) store.removeItem(k);
}

export async function resetDemoCompletely(): Promise<void> {
  if (typeof window === "undefined") return;
  // Läs principalId INNAN vi rensar `ava.firma`, så inloggningen bevaras.
  const prevPrincipal = loadFirmaConfig().principalId;

  await clearOpfsArtifacts();
  await clearFsaHandle();
  clearAvaStorage(window.localStorage);
  clearAvaStorage(window.sessionStorage);

  // Skriv tillbaka demo-config EXPLICIT (localhost-default = self-hosted).
  saveFirmaConfig({
    ...demoConfig(),
    ...(prevPrincipal ? { principalId: prevPrincipal } : {}),
  });
}
