/**
 * Tester för `useDemoRuntime`-hooken — React-bindningen för
 * `DemoRuntime` som UI-komponenter konsumerar.
 *
 * Designval (Liskov + DI):
 *   - Hooken tar in en factory för `DemoRuntime` så tester kan skapa
 *     en runtime med mockad cloneFn.
 *   - Returnerar `{ status, error, entities, loadDemo }` — read-only
 *     state + en enda action.
 *
 * SOLID:
 *   - Hooken har EN uppgift: synka React-state med DemoRuntime.
 *   - Den vet inget om Next, isomorphic-git eller fs.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDemoRuntime } from "@/lib/use-demo-runtime";
import { DemoRuntime } from "@/server/local-first/demo-runtime";

function fakeRuntime(data: Record<string, string>): DemoRuntime {
  return DemoRuntime.create({
    async cloneFn(fs) {
      for (const [path, content] of Object.entries(data)) {
        await fs.writeFile(path, content);
      }
    },
  });
}

describe("useDemoRuntime", () => {
  it("initialt state är idle med tom entities", () => {
    const { result } = renderHook(() => useDemoRuntime(() => fakeRuntime({})));
    expect(result.current.status).toBe("idle");
    expect(result.current.entities).toEqual({});
    expect(result.current.error).toBeNull();
  });

  it("loadDemo går idle → loading → loaded vid lyckad clone", async () => {
    const matterJson = JSON.stringify({
      id: "m1", matterNumber: "2026-0001", title: "X",
      status: "ACTIVE", organizationId: "demo",
    });
    const { result } = renderHook(() =>
      useDemoRuntime(() => fakeRuntime({ "matters/active/m1.json": matterJson })),
    );

    await act(async () => {
      await result.current.loadDemo("https://x/demo.git");
    });

    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(result.current.entities.matter).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("loadDemo går idle → loading → error vid clone-fel", async () => {
    const { result } = renderHook(() =>
      useDemoRuntime(() => DemoRuntime.create({
        cloneFn: async () => { throw new Error("offline"); },
      })),
    );

    await act(async () => {
      try {
        await result.current.loadDemo("https://x/demo.git");
      } catch { /* förväntat */ }
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/offline/);
  });

  it("ny loadDemo nollställer error från föregående försök", async () => {
    let attempts = 0;
    const { result } = renderHook(() =>
      useDemoRuntime(() => DemoRuntime.create({
        cloneFn: async (fs) => {
          attempts++;
          if (attempts === 1) throw new Error("offline");
          await fs.writeFile("matters/active/m1.json", JSON.stringify({
            id: "m1", matterNumber: "2026-0001", title: "X",
            status: "ACTIVE", organizationId: "demo",
          }));
        },
      })),
    );

    // Första försöket fail:ar
    await act(async () => {
      try { await result.current.loadDemo("a"); } catch { /* */ }
    });
    expect(result.current.status).toBe("error");

    // Andra försöket lyckas → error rensas
    await act(async () => { await result.current.loadDemo("a"); });
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(result.current.error).toBeNull();
  });

  it("hooken instansierar runtime exakt en gång (memoiserad)", () => {
    const factory = vi.fn(() => fakeRuntime({}));
    const { rerender } = renderHook(() => useDemoRuntime(factory));
    rerender();
    rerender();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
