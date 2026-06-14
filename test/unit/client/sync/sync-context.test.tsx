/**
 * Tester för `SyncProviderRoot` / `useSyncContext` (#27 — otestad wiring).
 * Mockar useAutoSync + useAuthMode (pickProvider är en prop → ingen mock).
 * Täcker: default utanför provider, provider-val + enabled-beräkning,
 * data-changed→notifyChange, lastError-persistens, och ava:repo-ready-ompick.
 */
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { SyncState } from "@/lib/client/sync/use-auto-sync";

const autoSync: { state: SyncState; syncNow: ReturnType<typeof vi.fn>; notifyChange: ReturnType<typeof vi.fn> } = {
  state: { kind: "synced", at: 0 },
  syncNow: vi.fn(async () => {}),
  notifyChange: vi.fn(),
};
let authMode = "identified-write";

vi.mock("@/lib/client/sync/use-auto-sync", () => ({ useAutoSync: () => autoSync }));
vi.mock("@/lib/client/auth/use-auth-mode", () => ({ useAuthMode: () => ({ mode: authMode }) }));

import { SyncProviderRoot, useSyncContext } from "@/lib/client/sync/sync-context";

function Probe() {
  const c = useSyncContext();
  return <div data-testid="v">{JSON.stringify({
    providerKind: c.providerKind, enabled: c.enabled, lastError: c.lastError, kind: c.state.kind,
  })}</div>;
}
const read = () => JSON.parse(screen.getByTestId("v").textContent ?? "{}");
const pickFsa = () => vi.fn(async () => ({ provider: {} as never, kind: "fsa" as const }));

beforeEach(() => {
  vi.clearAllMocks();
  autoSync.state = { kind: "synced", at: 0 };
  authMode = "identified-write";
});

describe("useSyncContext (utanför provider)", () => {
  it("ger no-op default", () => {
    render(<Probe />);
    expect(read()).toEqual({ providerKind: null, enabled: false, lastError: null, kind: "idle" });
  });
});

describe("SyncProviderRoot", () => {
  it("plockar provider → providerKind 'fsa' + enabled true; injicerat state syns", async () => {
    render(<SyncProviderRoot token="t" pickProvider={pickFsa()}><Probe /></SyncProviderRoot>);
    await waitFor(() => expect(read().providerKind).toBe("fsa"));
    expect(read().enabled).toBe(true);
    expect(read().kind).toBe("synced"); // bevisar att useAutoSync-mocken slog igenom
  });

  it("enabled=false när auth inte tillåter write (men provider vald)", async () => {
    authMode = "anonymous";
    render(<SyncProviderRoot token="t" pickProvider={pickFsa()}><Probe /></SyncProviderRoot>);
    await waitFor(() => expect(read().providerKind).toBe("fsa"));
    expect(read().enabled).toBe(false);
  });

  it("ava:data-changed → notifyChange (när write + provider)", async () => {
    render(<SyncProviderRoot token="t" pickProvider={pickFsa()}><Probe /></SyncProviderRoot>);
    await waitFor(() => expect(read().enabled).toBe(true));
    // Re-dispatcha inuti waitFor: lyssnaren kopplas i en effekt EFTER att
    // `enabled` blivit true → ett enstaka dispatch kan racea attach:en under
    // --parallel-last. Engångs-event:et "förbrukas" om lyssnaren inte hunnit,
    // så vi måste dispatcha om tills notifyChange faktiskt anropats.
    await waitFor(() => {
      act(() => { window.dispatchEvent(new Event("ava:data-changed")); });
      expect(autoSync.notifyChange).toHaveBeenCalled();
    });
  });

  it("persisterar lastError från error-state", async () => {
    autoSync.state = { kind: "error", message: "boom" };
    render(<SyncProviderRoot token="t" pickProvider={pickFsa()}><Probe /></SyncProviderRoot>);
    await waitFor(() => expect(read().lastError).toBe("boom"));
  });

  it("ava:repo-ready plockar om provider", async () => {
    const pick = pickFsa();
    render(<SyncProviderRoot token="t" pickProvider={pick}><Probe /></SyncProviderRoot>);
    await waitFor(() => expect(pick).toHaveBeenCalledTimes(1));
    act(() => { window.dispatchEvent(new Event("ava:repo-ready")); });
    await waitFor(() => expect(pick).toHaveBeenCalledTimes(2));
  });
});
