/**
 * Office 365-konfigurationen slås upp en gång per sidladdning och delas av alla
 * dokumentrader (#1951), också när svaret är `null` (ingen server, demon).
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { useOffice365Configured } from "@/components/documents/use-office365-configured";
import { testQueryClient } from "../../../helpers/trpc-fake";

let config: { clientId: string; tenantId: string } | null = null;
const resolve = vi.fn(() => Promise.resolve(config));
vi.mock("@/lib/client/integrations/office365-config", () => ({
  resolveOffice365Config: resolve,
  serverOffice365Config: () => Promise.resolve(null),
}));

function Row({ n }: { n: number }) {
  return <p>{`rad ${n}: ${useOffice365Configured() ? "maila" : "ingen"}`}</p>;
}

function renderRows() {
  render(
    <QueryClientProvider client={testQueryClient()}>
      <Row n={1} /><Row n={2} /><Row n={3} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { resolve.mockClear(); config = null; });

describe("useOffice365Configured (#1951)", () => {
  it("tre rader med konfiguration: en uppslagning, och alla får Maila…", async () => {
    config = { clientId: "c", tenantId: "t" };
    renderRows();
    await waitFor(() => expect(screen.getAllByText(/maila$/)).toHaveLength(3));
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("utan konfiguration delas också null: en uppslagning, ingen rad får Maila…", async () => {
    renderRows();
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(screen.getAllByText(/ingen$/)).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 20));
    expect(resolve).toHaveBeenCalledOnce();
  });
});
