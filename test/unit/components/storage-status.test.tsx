/**
 * `StorageStatus` (#1241) — visar på /settings om webbläsaren lovat att behålla
 * AVA:s lokala data (osynkade ändringar, ärenden offline).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { StorageStatus } from "@/components/settings/storage-status";
import type { StoragePersistence } from "@/lib/client/storage/persistent-storage";

const request = (value: StoragePersistence) => vi.fn(async () => value);

describe("StorageStatus", () => {
  it("beständig → lugnande besked", async () => {
    render(<StorageStatus request={request("persisted")} />);
    expect(await screen.findByText(/Beständig/)).toBeInTheDocument();
    expect(screen.getByTestId("storage-status")).toHaveAttribute("data-persistence", "persisted");
  });

  it("nekad → varning om att datan kan rensas och vad man gör åt det", async () => {
    render(<StorageStatus request={request("not-persisted")} />);
    expect(await screen.findByText(/Kan rensas av webbläsaren/)).toBeInTheDocument();
    expect(screen.getByText(/synka innan/i)).toBeInTheDocument();
    expect(screen.getByTestId("storage-status")).toHaveAttribute("data-persistence", "not-persisted");
  });

  it("stöds inte → säger det, utan att larma", async () => {
    render(<StorageStatus request={request("unsupported")} />);
    expect(await screen.findByText(/stöder inte beständig lagring/)).toBeInTheDocument();
  });

  it("medan frågan pågår → 'Kontrollerar…'", () => {
    render(<StorageStatus request={() => new Promise<StoragePersistence>(() => {})} />);
    expect(screen.getByText(/Kontrollerar/)).toBeInTheDocument();
  });
});
