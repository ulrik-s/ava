/**
 * Test för `MirrorOutlookRegistrar` (#27). Mockar trpc + integrations-registry.
 * Verifierar token-providerns tre källor (manuell localStorage → o365-connector
 * → null) inkl. icke-ansluten + kast, samt mirror-state-dispatchern och cleanup.
 */
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";

import { MirrorOutlookRegistrar } from "@/components/matter/mirror-outlook-registrar";
import {
  getOutlookToken, dispatchMirrorState,
  setOutlookTokenProvider, setMirrorStateDispatcher,
} from "@/lib/client/jobs/mirror-outlook-dispatch";

const mutateAsync = vi.fn(async () => {});
const getConnectorMock = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: { calendar: { setMirrorState: { useMutation: () => ({ mutateAsync }) } } },
}));
vi.mock("@/lib/client/integrations/registry", () => ({
  getConnector: (...a: unknown[]) => getConnectorMock(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getConnectorMock.mockReturnValue(null);
  localStorage.removeItem("ava.outlookToken");
});
afterEach(() => { setOutlookTokenProvider(null); setMirrorStateDispatcher(null); });

describe("MirrorOutlookRegistrar — token-provider", () => {
  it("manuell token i localStorage vinner", async () => {
    localStorage.setItem("ava.outlookToken", "manual-tok");
    render(<MirrorOutlookRegistrar />);
    expect(await getOutlookToken()).toBe("manual-tok");
  });

  it("ingen connector → null", async () => {
    getConnectorMock.mockReturnValue(null);
    render(<MirrorOutlookRegistrar />);
    expect(await getOutlookToken()).toBeNull();
  });

  it("ansluten connector → access-token", async () => {
    getConnectorMock.mockReturnValue({
      getStatus: async () => ({ kind: "connected" }),
      getAccessToken: async () => "graph-tok",
    });
    render(<MirrorOutlookRegistrar />);
    expect(await getOutlookToken()).toBe("graph-tok");
  });

  it("icke-ansluten connector → null", async () => {
    getConnectorMock.mockReturnValue({
      getStatus: async () => ({ kind: "disconnected" }),
      getAccessToken: async () => "x",
    });
    render(<MirrorOutlookRegistrar />);
    expect(await getOutlookToken()).toBeNull();
  });

  it("connector-kast → null (catch)", async () => {
    getConnectorMock.mockImplementation(() => { throw new Error("registry boom"); });
    render(<MirrorOutlookRegistrar />);
    expect(await getOutlookToken()).toBeNull();
  });
});

describe("MirrorOutlookRegistrar — mirror-state-dispatcher", () => {
  it("mappar patch → setMirrorState.mutateAsync (med ?? null-fallbacks)", async () => {
    render(<MirrorOutlookRegistrar />);
    await dispatchMirrorState({ eventId: "e1", patch: { mirrorStatus: "synced", outlookEventId: "ox-1" } });
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "e1",
      outlookEventId: "ox-1",
      mirrorStatus: "synced",
      mirrorError: null,
      mirrorLastSyncedAt: null,
    });
  });

  it("unmount avregistrerar både provider och dispatcher", async () => {
    const { unmount } = render(<MirrorOutlookRegistrar />);
    unmount();
    expect(await getOutlookToken()).toBeNull();
    await expect(dispatchMirrorState({ eventId: "e2", patch: { mirrorStatus: "pending" } }))
      .rejects.toThrow(/Ingen mirror-state-dispatcher/);
  });
});
