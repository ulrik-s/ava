/**
 * Tester för `resetDemoCompletely` — den fullständiga "Återställ demo"-
 * rensningen. Vi bevisar att VARJE persistens-lager rensas och att
 * localhost-fällan (default-tier = self-hosted) undviks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";

// handle-store importeras dynamiskt i reset-demo → mocka deleteHandle.
const deleteHandle = vi.fn(async () => {});
vi.mock("@/lib/client/fsa/handle-store", () => ({ deleteHandle }));

function makeStorage(init: Record<string, string> = {}): Storage {
  const m = new Map<string, string>(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  } as Storage;
}

interface OpfsMock {
  root: { keys(): AsyncIterableIterator<string>; removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> };
  removed: string[];
}

function makeOpfs(names: string[]): OpfsMock {
  const removed: string[] = [];
  return {
    root: {
      async *keys() { for (const n of names) yield n; },
      async removeEntry(name: string) { removed.push(name); },
    },
    removed,
  };
}

function stubBrowser(opts: {
  ls: Storage;
  ss: Storage;
  hostname?: string;
  getDirectory?: () => Promise<OpfsMock["root"]>;
}): void {
  vi.stubGlobal("window", {
    localStorage: opts.ls,
    sessionStorage: opts.ss,
    location: { hostname: opts.hostname ?? "localhost" },
  });
  vi.stubGlobal("localStorage", opts.ls); // firma-config läser global localStorage
  vi.stubGlobal("navigator", { storage: opts.getDirectory ? { getDirectory: opts.getDirectory } : {} });
}

describe("resetDemoCompletely", () => {
  beforeEach(() => { deleteHandle.mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("raderar alla ava.*-nycklar men bevarar icke-ava-nycklar", async () => {
    const ls = makeStorage({
      "ava.theme": "dark",
      "ava.oauthConfig": "{...}",
      "ava.llm": "{...}",
      "keep.me": "x",
    });
    const ss = makeStorage({ "ava.demoBannerDismissed": "1", "other.key": "/foo" });
    stubBrowser({ ls, ss });

    const { resetDemoCompletely } = await import("@/lib/client/demo/reset-demo");
    await resetDemoCompletely();

    expect(ls.getItem("ava.theme")).toBeNull();
    expect(ls.getItem("ava.oauthConfig")).toBeNull();
    expect(ls.getItem("ava.llm")).toBeNull();
    expect(ls.getItem("keep.me")).toBe("x");
    expect(ss.getItem("ava.demoBannerDismissed")).toBeNull();
    expect(ss.getItem("other.key")).toBe("/foo");
  });

  it("skriver tillbaka demo-config EXPLICIT på localhost (annars self-hosted-default)", async () => {
    const ls = makeStorage({ "ava.firma": JSON.stringify({ tier: "self-hosted", repo: "http://x" }) });
    stubBrowser({ ls, ss: makeStorage(), hostname: "localhost" });

    const { resetDemoCompletely } = await import("@/lib/client/demo/reset-demo");
    await resetDemoCompletely();

    const firma = JSON.parse(ls.getItem("ava.firma")!);
    expect(firma.tier).toBe("demo");
  });

  it("bevarar principalId (man förblir inloggad)", async () => {
    const ls = makeStorage({ "ava.firma": JSON.stringify({ tier: "demo", repo: "u/r", principalId: "user-42" }) });
    stubBrowser({ ls, ss: makeStorage() });

    const { resetDemoCompletely } = await import("@/lib/client/demo/reset-demo");
    await resetDemoCompletely();

    expect(JSON.parse(ls.getItem("ava.firma")!).principalId).toBe("user-42");
  });

  it("raderar OPFS ava-demo*-snapshots + working-copy, lämnar annat", async () => {
    const opfs = makeOpfs(["ava-demo__snapshot.json", "ava-demo-abc123__snapshot.json", "working-copy", "other-thing"]);
    stubBrowser({ ls: makeStorage(), ss: makeStorage(), getDirectory: async () => opfs.root });

    const { resetDemoCompletely } = await import("@/lib/client/demo/reset-demo");
    await resetDemoCompletely();

    expect(opfs.removed).toEqual(expect.arrayContaining(["ava-demo__snapshot.json", "ava-demo-abc123__snapshot.json", "working-copy"]));
    expect(opfs.removed).not.toContain("other-thing");
  });

  it("raderar FSA-handeln repo-root ur IndexedDB", async () => {
    stubBrowser({ ls: makeStorage(), ss: makeStorage() });
    const { resetDemoCompletely } = await import("@/lib/client/demo/reset-demo");
    await resetDemoCompletely();
    expect(deleteHandle).toHaveBeenCalledWith("repo-root");
  });

  it("är best-effort: OPFS-fel kastar inte vidare", async () => {
    stubBrowser({ ls: makeStorage(), ss: makeStorage(), getDirectory: async () => { throw new Error("OPFS nere"); } });
    const { resetDemoCompletely } = await import("@/lib/client/demo/reset-demo");
    await expect(resetDemoCompletely()).resolves.toBeUndefined();
  });

  it("no-op när window saknas (SSR)", async () => {
    vi.stubGlobal("window", undefined);
    const { resetDemoCompletely } = await import("@/lib/client/demo/reset-demo");
    await expect(resetDemoCompletely()).resolves.toBeUndefined();
    expect(deleteHandle).not.toHaveBeenCalled();
  });
});
