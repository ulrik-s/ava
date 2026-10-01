/**
 * Enheter och synk (#1267): adminens tabell, bevakningen i Att bevaka och sidan.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { SyncDevice } from "@/lib/shared/sync/device-health";

const NOW = Date.UTC(2026, 8, 30, 12, 0);
const HOUR = 3600_000;
const state = {
  devices: undefined as SyncDevice[] | undefined,
  canSee: true,
  forgotten: [] as string[],
};

vi.mock("@/lib/client/backend/sync-devices", () => ({
  useSyncDevices: () => ({ data: state.devices, isSuccess: state.devices !== undefined }),
  useCanSeeSyncDevices: () => state.canSee,
  useForgetSyncDevice: () => ({ isPending: false, mutate: (id: string) => { state.forgotten.push(id); } }),
}));
vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { list: { useQuery: () => ({ data: { users: [{ id: "u-anna", name: "Anna Advokat" }] } }) } } },
}));

const { SyncDevicesSection } = await import("@/components/sync/sync-devices-section");
const { StaleDevicesNotice } = await import("@/components/sync/stale-devices-notice");
const { default: SyncDevicesPage } = await import("@/app/sync-devices/page");

const device = (over: Partial<SyncDevice>): SyncDevice => ({
  deviceId: "d1", userId: "u-anna", label: "Chrome på macOS", pendingCount: 0, oldestPendingAt: null, lastError: null, lastSeenAt: NOW, ...over,
});

beforeEach(() => {
  state.devices = undefined;
  state.canSee = true;
  state.forgotten = [];
});

describe("SyncDevicesSection", () => {
  it("visas inte när översikten inte är tillgänglig", () => {
    const { container } = render(<SyncDevicesSection now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("inga enheter än", () => {
    state.devices = [];
    render(<SyncDevicesSection now={NOW} />);
    expect(screen.getByText(/Ingen enhet har synkat än/)).toBeInTheDocument();
  });

  it("en rad per enhet: användare, enhet, kö och läge", () => {
    state.devices = [
      device({ deviceId: "ok" }),
      device({ deviceId: "stuck", userId: "okänd", label: null, pendingCount: 3, oldestPendingAt: NOW - 30 * HOUR }),
      device({ deviceId: "one", pendingCount: 1, oldestPendingAt: null, lastSeenAt: NOW - 8 * 24 * HOUR }),
    ];
    render(<SyncDevicesSection now={NOW} />);
    const rows = screen.getAllByTestId("sync-device-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/Anna Advokat.*Chrome på macOS.*Inget.*OK/);
    expect(rows[1]).toHaveTextContent(/Okänd användare.*Okänd enhet.*3 ändringar \(äldsta .*\).*Osynkat > 1 dygn/);
    expect(rows[2]).toHaveTextContent(/1 ändring.*Ingen synk på en vecka/);
  });

  it("enhetens senaste synkfel visas (#1353); utan fel visas inget", () => {
    state.devices = [device({ deviceId: "fel", pendingCount: 2, lastError: "Kunde inte spara till servern: 500" }), device({ deviceId: "ok" })];
    render(<SyncDevicesSection now={NOW} />);
    const errors = screen.getAllByTestId("sync-device-error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toHaveTextContent("Senaste synkfel: Kunde inte spara till servern: 500");
  });

  it("Glöm frågar först och glömmer sedan enheten", () => {
    state.devices = [device({ deviceId: "gammal" })];
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<SyncDevicesSection />);
    fireEvent.click(screen.getByRole("button", { name: "Glöm" }));
    expect(state.forgotten).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Glöm" }));
    expect(state.forgotten).toEqual(["gammal"]);
    confirm.mockRestore();
  });
});

describe("StaleDevicesNotice", () => {
  it("ingen bevakning när allt är i ordning", () => {
    state.devices = [device({})];
    const { container } = render(<StaleDevicesNotice now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("bevakningen räknar enheterna som larmar och leder till översikten", () => {
    state.devices = [device({ pendingCount: 1, oldestPendingAt: NOW - 25 * HOUR }), device({ deviceId: "d2", lastSeenAt: NOW - 8 * 24 * HOUR })];
    render(<StaleDevicesNotice now={NOW} />);
    const link = screen.getByTestId("stale-devices-notice");
    expect(link).toHaveTextContent(/2 enheter/);
    expect(link).toHaveAttribute("href", "/sync-devices");
  });

  it("en enhet i singular; utan now används tiden då vyn öppnades", () => {
    state.devices = [device({ lastSeenAt: 0 })];
    render(<StaleDevicesNotice />);
    expect(screen.getByTestId("stale-devices-notice")).toHaveTextContent(/1 enhet har/);
  });
});

describe("SyncDevicesPage", () => {
  it("admin mot server ser tabellen", () => {
    state.devices = [device({})];
    render(<SyncDevicesPage />);
    expect(screen.getByRole("heading", { name: "Enheter och synk" })).toBeInTheDocument();
    expect(screen.getByTestId("sync-devices")).toBeInTheDocument();
  });

  it("annars ett besked om vem översikten är för", () => {
    state.canSee = false;
    render(<SyncDevicesPage />);
    expect(screen.getByText(/Översikten finns för administratörer/)).toBeInTheDocument();
  });
});
