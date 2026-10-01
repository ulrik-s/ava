/**
 * Backup på begäran (#1431) från klienten: läses och begärs AV SERVERN, bara
 * för admin mot en server som har det; nedladdningen är en vanlig länk.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { backupFileNameSchema, type BackupStatus } from "@/lib/shared/backup";

const state = { backup: true, role: "ADMIN", statusCalls: 0, status: null as BackupStatus | null, requested: 0 };

vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => ({ backup: state.backup }) }));
vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { current: { useQuery: (_: unknown, o: { enabled: boolean }) => ({ data: o.enabled ? { role: state.role } : undefined }) } } },
}));
vi.mock("@/lib/client/backend/server-trpc-client", () => ({
  serverTrpcClient: () => ({
    backup: {
      status: { query: async () => { state.statusCalls++; return state.status; } },
      request: { mutate: async () => { state.requested++; return { ...idle(), state: "running", requestedAt: 5 }; } },
    },
  }),
}));

const { BACKUP_POLL_MS, backupRefetchInterval, downloadBackup, useBackupStatus, useCanSeeBackup, useRequestBackup } = await import("@/lib/client/backend/server-backup");

function idle(): BackupStatus {
  return { state: "idle", latest: null, requestedAt: null, nextRequestAt: 0 };
}

function wrapper() {
  const qc = new QueryClient();
  return { qc, wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
}

beforeEach(() => {
  state.backup = true;
  state.role = "ADMIN";
  state.statusCalls = 0;
  state.status = idle();
  state.requested = 0;
});

describe("useCanSeeBackup / useBackupStatus", () => {
  it("admin mot en server med backup: läget hämtas från servern", async () => {
    const { result } = renderHook(() => useBackupStatus(), { wrapper: wrapper().wrapper });
    await waitFor(() => expect(result.current.data).toEqual(idle()));
  });

  it("jurist, eller servern utan backup: inget visas och inget hämtas", () => {
    state.role = "LAWYER";
    expect(renderHook(() => useCanSeeBackup(), { wrapper: wrapper().wrapper }).result.current).toBe(false);
    state.role = "ADMIN";
    state.backup = false;
    expect(renderHook(() => useCanSeeBackup(), { wrapper: wrapper().wrapper }).result.current).toBe(false);
    renderHook(() => useBackupStatus(), { wrapper: wrapper().wrapper });
    expect(state.statusCalls).toBe(0);
  });

  it("läget hämtas igen var femte sekund bara medan en backup pågår", () => {
    expect(backupRefetchInterval({ ...idle(), state: "running", requestedAt: 1 })).toBe(BACKUP_POLL_MS);
    expect(BACKUP_POLL_MS).toBe(5_000);
    expect(backupRefetchInterval(idle())).toBe(false);
    expect(backupRefetchInterval(undefined)).toBe(false);
  });
});

describe("useRequestBackup", () => {
  it("begär och lägger serverns svar i läget", async () => {
    const { qc, wrapper: w } = wrapper();
    const { result } = renderHook(() => useRequestBackup(), { wrapper: w });
    await act(async () => { await result.current.mutateAsync(); });
    expect(state.requested).toBe(1);
    expect(qc.getQueryData(["server", "backup.status"])).toMatchObject({ state: "running", requestedAt: 5 });
  });
});

describe("downloadBackup", () => {
  it("en länk till nedladdningsrouten klickas och tas bort", () => {
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(`${this.getAttribute("href")}|${this.download}`);
    });
    downloadBackup(backupFileNameSchema.parse("ava-2026-10-01-0300.tar.age"));
    expect(clicked).toEqual(["/api/backup/download?name=ava-2026-10-01-0300.tar.age|ava-2026-10-01-0300.tar.age"]);
    expect(document.querySelector("a[download]")).toBeNull();
    click.mockRestore();
  });
});
