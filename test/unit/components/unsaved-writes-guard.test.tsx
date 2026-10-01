/**
 * `UnsavedWritesGuard` (#1386) — sidan varnar för omladdning medan en lokal
 * ändring skrivs till IndexedDB, och bara då.
 */
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import { UnsavedWritesGuard } from "@/components/shell/unsaved-writes-guard";
import { CachingSyncDataStore, noSyncTransport } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { uuidv7 } from "@/lib/shared/uuid";

/** Försöker ladda om: true om sidan bad webbläsaren att fråga först. */
function tryUnload(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** En store vars snapshot-skrivning hålls kvar tills `release()`. */
async function heldStore() {
  let release: () => void = () => undefined;
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const persistence = {
    hydrate: async () => null,
    save: () => new Promise<void>((resolve) => { release = resolve; markStarted(); }),
  };
  const store = await CachingSyncDataStore.create({ transport: noSyncTransport, persistence });
  return { store, started, release: () => release() };
}

describe("UnsavedWritesGuard", () => {
  it("varnar under skrivningen, inte före eller efter", async () => {
    const { store, started, release } = await heldStore();
    render(<UnsavedWritesGuard store={store} />);
    expect(tryUnload()).toBe(false);

    let saving: Promise<unknown> = Promise.resolve();
    await act(async () => {
      saving = store.store.matters.create({ data: { id: uuidv7(), title: "Nytt" } as never });
      await started;
    });
    expect(tryUnload()).toBe(true);

    await act(async () => { release(); await saving; });
    expect(tryUnload()).toBe(false);
  });

  it("varnar direkt om en skrivning redan pågår, och slutar när komponenten tas bort", async () => {
    const { store, started, release } = await heldStore();
    const saving = store.store.matters.create({ data: { id: uuidv7(), title: "Nytt" } as never });
    await started;
    const { unmount } = render(<UnsavedWritesGuard store={store} />);
    expect(tryUnload()).toBe(true);
    unmount();
    expect(tryUnload()).toBe(false);
    release();
    await saving;
  });

  it("utan store (ännu inte uppstartad) gör den ingenting", () => {
    render(<UnsavedWritesGuard store={null} />);
    expect(tryUnload()).toBe(false);
  });
});
