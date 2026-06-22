/**
 * useLeaseAwareOpen (ADR 0033 §2) — read-only-utfall → visar LeaseModal;
 * "Ta över" → takeoverLease + öppnar om. openDocumentSmart + trpc mockas.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { useLeaseAwareOpen } from "@/components/documents/use-lease-aware-open";

type Outcome = { kind: "done" } | { kind: "read-only"; leaseHolder?: string };
const openMock = vi.fn<(doc: unknown, onModal: unknown, opts?: unknown) => Promise<Outcome>>();
const takeoverMock = { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false };

vi.mock("@/lib/client/trpc", () => ({
  trpc: { document: { takeoverLease: { useMutation: () => takeoverMock } } },
}));
vi.mock("@/lib/client/firma/open-document-externally", () => ({
  openDocumentSmart: (doc: unknown, onModal: unknown, opts?: unknown) => openMock(doc, onModal, opts),
}));

function Harness() {
  const { openDocument, leaseModal } = useLeaseAwareOpen();
  const doc = { id: "d1", fileName: "avtal.docx", storagePath: "p" };
  return (
    <div>
      <button onClick={() => void openDocument(doc, () => { /* */ })}>open</button>
      {leaseModal}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  takeoverMock.mutateAsync.mockResolvedValue({});
});

describe("useLeaseAwareOpen", () => {
  it("read-only-utfall → visar LeaseModal med hållaren", async () => {
    openMock.mockResolvedValue({ kind: "read-only", leaseHolder: "Anna" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByText(/Anna redigerar det här dokumentet/)).toBeTruthy();
  });

  it("'done'-utfall → ingen modal", async () => {
    openMock.mockResolvedValue({ kind: "done" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(openMock).toHaveBeenCalled());
    expect(screen.queryByText(/redigerar det här dokumentet/)).toBeNull();
  });

  it("'Ta över' → takeoverLease(documentId) + öppnar om, modal stängs", async () => {
    openMock.mockResolvedValueOnce({ kind: "read-only", leaseHolder: "Anna" }); // första öppningen
    openMock.mockResolvedValueOnce({ kind: "done" }); // re-open efter takeover
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ta över redigeringen" }));
    await waitFor(() => expect(takeoverMock.mutateAsync).toHaveBeenCalledWith({ documentId: "d1" }));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2)); // öppnade om
    await waitFor(() => expect(screen.queryByText(/Anna redigerar/)).toBeNull());
  });

  it("'Öppna ändå' → öppnar om med forceEdit", async () => {
    openMock.mockResolvedValueOnce({ kind: "read-only", leaseHolder: "Anna" });
    openMock.mockResolvedValueOnce({ kind: "done" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Öppna ändå för redigering" }));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2));
    expect(openMock.mock.calls[1]?.[2]).toEqual({ forceEdit: true });
  });
});
