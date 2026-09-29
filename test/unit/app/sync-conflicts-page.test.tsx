/**
 * `/sync-conflicts` (#1266) — listar flikens avvisade ändringar; Kasta tar
 * bort, Försök igen köar via den registrerade synken.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import SyncConflictsPage from "@/app/sync-conflicts/page";
import { InMemoryRejectedChangesPersistence, rejectedChanges } from "@/lib/client/backend/rejected-changes";

const entry = { mutationId: "m1", entity: "invoice", kind: "update" as const, row: { id: "i" }, enqueuedAt: 0 };

describe("SyncConflictsPage", () => {
  it("visar de avvisade ändringarna, och försök igen / kasta tömmer listan", async () => {
    await rejectedChanges.attach(new InMemoryRejectedChangesPersistence());
    await rejectedChanges.record([
      { mutation: entry, conflictClass: "surface", reason: "stale" },
      { mutation: { ...entry, mutationId: "m2" }, conflictClass: "surface", reason: "Låst post" },
    ]);
    const retried: string[] = [];
    const off = rejectedChanges.setRetryHandler(async (c) => { retried.push(c.id); });
    render(<SyncConflictsPage />);
    expect(screen.getByRole("heading", { name: "Avvisade ändringar" })).toBeInTheDocument();
    expect(screen.getAllByTestId("rejected-change")).toHaveLength(2);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Försök igen" })[0]!); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Kasta" })[0]!); });
    await waitFor(() => expect(screen.getByText(/Inga avvisade ändringar/)).toBeInTheDocument());
    expect(retried).toEqual(["m1"]);
    off();
  });
});
