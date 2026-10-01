/**
 * Inställningar → Backup (#1431): knappen, läget, förklaringen om krypteringen,
 * och att den backup DEN HÄR fliken begärde laddas ner när den är klar.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { backupFileNameSchema, sha256HexSchema, type BackupStatus } from "@/lib/shared/backup";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const NAME = backupFileNameSchema.parse("ava-2026-10-01-0300.tar.age");
const SHA = sha256HexSchema.parse("c".repeat(64));

const hooks = {
  visible: true,
  status: { data: undefined as BackupStatus | undefined, error: null as { message: string } | null },
  request: { isPending: false, error: null as { message: string } | null, mutate: vi.fn() },
  downloads: [] as string[],
};

vi.mock("@/lib/client/backend/server-backup", () => ({
  useCanSeeBackup: () => hooks.visible,
  useBackupStatus: () => hooks.status,
  useRequestBackup: () => hooks.request,
  downloadBackup: (name: string) => { hooks.downloads.push(name); },
}));

const { BackupSection, RESTORE_RUNBOOK_URL } = await import("@/components/settings/backup-section");

function status(over: Partial<BackupStatus> = {}): BackupStatus {
  return { state: "idle", latest: { name: NAME, sizeBytes: 3 * 1024 * 1024, createdAt: NOW - 120 * MIN, sha256: SHA }, requestedAt: null, nextRequestAt: NOW - 110 * MIN, ...over };
}

beforeEach(() => {
  hooks.visible = true;
  hooks.status = { data: status(), error: null };
  hooks.request = { isPending: false, error: null, mutate: vi.fn() };
  hooks.downloads = [];
});

describe("BackupSection", () => {
  it("syns inte för den som inte får se den", () => {
    hooks.visible = false;
    const { container } = render(<BackupSection now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("förklarar krypteringen och länkar återställningsrunbooken", () => {
    render(<BackupSection now={NOW} />);
    expect(screen.getByText(/privata age-nyckel/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "återställningsrunbooken" })).toHaveAttribute("href", RESTORE_RUNBOOK_URL);
  });

  it("visar senaste backupen med storlek och checksumma; Ladda ner hämtar den", () => {
    render(<BackupSection now={NOW} />);
    expect(screen.getByTestId("backup-latest")).toHaveTextContent("3.0 MB");
    expect(screen.getByTestId("backup-sha256")).toHaveTextContent(SHA);
    fireEvent.click(screen.getByRole("button", { name: /Ladda ner/ }));
    expect(hooks.downloads).toEqual([NAME]);
  });

  it("ingen backup än; checksumma som saknas sägs ut", () => {
    hooks.status.data = status({ latest: null, nextRequestAt: 0 });
    const { unmount } = render(<BackupSection now={NOW} />);
    expect(screen.getByText("Ingen backup finns än.")).toBeInTheDocument();
    unmount();
    const latest = status().latest;
    hooks.status.data = status({ latest: latest ? { ...latest, sha256: null } : null });
    render(<BackupSection now={NOW} />);
    expect(screen.getByTestId("backup-sha256")).toHaveTextContent("saknas");
  });

  it("Ta backup nu begär en backup", () => {
    render(<BackupSection now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Ta backup nu" }));
    expect(hooks.request.mutate).toHaveBeenCalled();
  });

  it("pågår: knappen är avstängd och läget säger att filen kommer", () => {
    hooks.status.data = status({ state: "running", requestedAt: NOW - MIN, nextRequestAt: NOW + 9 * MIN });
    render(<BackupSection now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent("Backup pågår");
    expect(screen.getByRole("button", { name: "Ta backup nu" })).toBeDisabled();
    expect(screen.queryByText(/Nästa backup kan tas/)).not.toBeInTheDocument();
  });

  it("för tidigt efter förra: avstängd, med tiden då nästa kan tas", () => {
    hooks.status.data = status({ nextRequestAt: NOW + 5 * MIN });
    render(<BackupSection now={NOW} />);
    expect(screen.getByRole("button", { name: "Ta backup nu" })).toBeDisabled();
    expect(screen.getByText(/Nästa backup kan tas/)).toBeInTheDocument();
  });

  it("misslyckad och fel visas", () => {
    hooks.status.data = status({ state: "failed", requestedAt: NOW - 70 * MIN });
    hooks.status.error = { message: "servern svarar inte" };
    hooks.request.error = { message: "En backup pågår redan." };
    render(<BackupSection now={NOW} />);
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts.some((t) => t?.includes("blev inte klar inom en timme"))).toBe(true);
    expect(alerts).toContain("servern svarar inte");
    expect(alerts).toContain("En backup pågår redan.");
  });

  it("den här flikens backup laddas ner när den är klar — en gång", () => {
    hooks.request.mutate = vi.fn((_: unknown, o: { onSuccess: (s: BackupStatus) => void }) => {
      o.onSuccess(status({ state: "running", requestedAt: NOW, nextRequestAt: NOW + 10 * MIN }));
    });
    const { rerender } = render(<BackupSection now={NOW} />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Ta backup nu" })); });
    expect(hooks.downloads).toEqual([]);
    // Servern: klar — en export som skrevs efter begäran.
    const done = status({ requestedAt: NOW, latest: { name: NAME, sizeBytes: 10, createdAt: NOW + 4 * MIN, sha256: SHA }, nextRequestAt: NOW + 14 * MIN });
    hooks.status = { data: done, error: null };
    rerender(<BackupSection now={NOW} />);
    expect(hooks.downloads).toEqual([NAME]);
    hooks.status = { data: { ...done }, error: null };
    rerender(<BackupSection now={NOW} />);
    expect(hooks.downloads).toEqual([NAME]);
  });

  it("utan fast tid tickar klockan", () => {
    vi.useFakeTimers();
    hooks.status.data = status({ nextRequestAt: Date.now() + 10_000 });
    render(<BackupSection />);
    expect(screen.getByRole("button", { name: "Ta backup nu" })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(screen.getByRole("button", { name: "Ta backup nu" })).not.toBeDisabled();
    vi.useRealTimers();
  });
});
