/**
 * Tester för `AutoSync` — top-bar wrapper runt SyncStatusPill.
 *
 */

import { describe, it, expect, vi } from "vitest-compat";
import { render, screen } from "@testing-library/react";
import { AutoSync } from "@/components/shell/auto-sync";
import type { SyncState } from "@/lib/client/sync/use-auto-sync";

const ctxState = {
  state: { kind: "synced", at: Date.now() } as SyncState,
  syncNow: vi.fn(),
  notifyChange: vi.fn(),
  providerKind: "fsa" as "fsa" | null,
  lastError: null,
};

vi.mock("@/lib/client/sync/sync-context", () => ({
  useSyncContext: () => ctxState,
}));

describe("AutoSync", () => {
  it("renderar inget när ingen provider", () => {
    ctxState.providerKind = null;
    const { container } = render(<AutoSync />);
    expect(container.firstChild).toBeNull();
  });

  it("renderar SyncStatusPill när provider finns", () => {
    ctxState.providerKind = "fsa";
    render(<AutoSync />);
    expect(screen.getByText(/Sparat/)).toBeInTheDocument();
  });
});
