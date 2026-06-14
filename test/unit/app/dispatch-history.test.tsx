import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { DispatchHistory } from "@/app/invoices/[id]/_dispatch-history";

const listQuery = { data: undefined as unknown[] | undefined, isLoading: false };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    invoiceDispatch: { list: { useQuery: () => listQuery } },
  },
}));

describe("DispatchHistory", () => {
  it("visar tomt-läge när inga utskick finns", () => {
    listQuery.data = [];
    render(<DispatchHistory invoiceId="inv-1" />);
    expect(screen.getByText(/Inga utskick registrerade/)).toBeTruthy();
  });

  it("listar utskick med kanal, mottagare och status", () => {
    listQuery.data = [
      { id: "d-1", channel: "email", recipient: "klient@x.se", status: "sent", queuedAt: "2026-06-01T10:00:00Z" },
      { id: "d-2", channel: "kivra", recipient: "199001011234", status: "failed", queuedAt: "2026-06-02T10:00:00Z", error: "okänd mottagare" },
    ];
    render(<DispatchHistory invoiceId="inv-1" />);
    expect(screen.getByText(/klient@x\.se/)).toBeTruthy();
    expect(screen.getByText(/Skickad/)).toBeTruthy();
    expect(screen.getByText(/Misslyckad/)).toBeTruthy();
    expect(screen.getByText(/Kivra/)).toBeTruthy();
  });
});
