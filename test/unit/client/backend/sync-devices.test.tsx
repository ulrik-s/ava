/**
 * Adminens översikt över enheterna (#1267) — läses från SERVERN, bara för admin
 * och bara när det finns en server.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

const state = { sync: true, role: "ADMIN", listed: 0, forgotten: [] as string[] };

vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => ({ sync: state.sync }) }));
vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { current: { useQuery: (_: unknown, o: { enabled: boolean }) => ({ data: o.enabled ? { role: state.role } : undefined }) } } },
}));
vi.mock("@/lib/client/backend/server-trpc-client", () => ({
  serverTrpcClient: () => ({
    sync: {
      devices: { query: async () => { state.listed++; return [{ deviceId: "d1" }]; } },
      forgetDevice: { mutate: async ({ deviceId }: { deviceId: string }) => { state.forgotten.push(deviceId); return { ok: true }; } },
    },
  }),
}));

const { useCanSeeSyncDevices, useForgetSyncDevice, useSyncDevices } = await import("@/lib/client/backend/sync-devices");

const wrapper = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

beforeEach(() => {
  state.sync = true;
  state.role = "ADMIN";
  state.listed = 0;
  state.forgotten = [];
});

describe("useSyncDevices", () => {
  it("admin mot server: listan hämtas från servern", async () => {
    const { result } = renderHook(() => useSyncDevices(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ deviceId: "d1" }]));
  });

  it("jurist eller demo (ingen server): ingen hämtning", async () => {
    state.role = "LAWYER";
    expect(renderHook(() => useCanSeeSyncDevices(), { wrapper }).result.current).toBe(false);
    state.role = "ADMIN";
    state.sync = false;
    expect(renderHook(() => useCanSeeSyncDevices(), { wrapper }).result.current).toBe(false);
    renderHook(() => useSyncDevices(), { wrapper });
    expect(state.listed).toBe(0);
  });

  it("glöm en enhet", async () => {
    const { result } = renderHook(() => useForgetSyncDevice(), { wrapper });
    await act(async () => { await result.current.mutateAsync("gammal"); });
    expect(state.forgotten).toEqual(["gammal"]);
  });
});
