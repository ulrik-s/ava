/**
 * Adminens översikt över enheterna (#1267) — läses från SERVERN, bara för admin
 * och bara när det finns en server.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { callsTo } from "../../../helpers/trpc-both-fake";
import { fakeTrpcWrapper, type FakeTrpcWrapper } from "../../../helpers/trpc-fake";

const state = { sync: true, role: "ADMIN", listed: 0, forgotten: [] as string[] };

vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => ({ sync: state.sync }) }));
vi.mock("@/lib/client/backend/server-trpc-client", () => ({
  serverTrpcClient: () => ({
    sync: {
      devices: { query: async () => { state.listed++; return [{ deviceId: "d1" }]; } },
      forgetDevice: { mutate: async ({ deviceId }: { deviceId: string }) => { state.forgotten.push(deviceId); return { ok: true }; } },
    },
  }),
}));

const { useCanSeeSyncDevices, useForgetSyncDevice, useSyncDevices } = await import("@/lib/client/backend/sync-devices");

/** En ny länk där `user.current` svarar med testets roll. */
const trpcWrapper = (): FakeTrpcWrapper => fakeTrpcWrapper({ "user.current": () => ({ role: state.role }) });

beforeEach(() => {
  state.sync = true;
  state.role = "ADMIN";
  state.listed = 0;
  state.forgotten = [];
});

describe("useSyncDevices", () => {
  it("admin mot server: listan hämtas från servern", async () => {
    const { wrapper } = trpcWrapper();
    const { result } = renderHook(() => useSyncDevices(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ deviceId: "d1" }]));
  });

  it("jurist eller demo (ingen server): ingen hämtning", async () => {
    state.role = "LAWYER";
    const jurist = trpcWrapper();
    const lawyer = renderHook(() => useCanSeeSyncDevices(), { wrapper: jurist.wrapper });
    await waitFor(() => expect(callsTo(jurist.fake, "user.current")).toHaveLength(1));
    await waitFor(() => expect(jurist.queryClient.isFetching()).toBe(0));
    expect(lawyer.result.current).toBe(false);
    state.role = "ADMIN";
    state.sync = false;
    const demo = trpcWrapper();
    expect(renderHook(() => useCanSeeSyncDevices(), { wrapper: demo.wrapper }).result.current).toBe(false);
    renderHook(() => useSyncDevices(), { wrapper: demo.wrapper });
    await waitFor(() => expect(demo.queryClient.isFetching()).toBe(0));
    // Utan server frågas inte ens efter rollen.
    expect(callsTo(demo.fake, "user.current")).toEqual([]);
    expect(state.listed).toBe(0);
  });

  it("glöm en enhet", async () => {
    const { wrapper } = trpcWrapper();
    const { result } = renderHook(() => useForgetSyncDevice(), { wrapper });
    await act(async () => { await result.current.mutateAsync("gammal"); });
    expect(state.forgotten).toEqual(["gammal"]);
  });
});
