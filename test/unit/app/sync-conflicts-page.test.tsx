/**
 * `/sync-conflicts` (#1266) — listar flikens avvisade ändringar; Kasta
 * återställer serverns läge och tar bort (#1348), Försök igen köar via den
 * registrerade synken — och visas bara där ett nytt försök kan lyckas.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import SyncConflictsPage from "@/app/sync-conflicts/page";
import { InMemoryRejectedChangesPersistence, rejectedChanges } from "@/lib/client/backend/rejected-changes";

const entry = { mutationId: "m1", entity: "task", kind: "update" as const, row: { id: "i" }, enqueuedAt: 0 };

describe("SyncConflictsPage", () => {
  it("visar de avvisade ändringarna, och försök igen / kasta tömmer listan", async () => {
    await rejectedChanges.attach(new InMemoryRejectedChangesPersistence());
    await rejectedChanges.record([
      { mutation: entry, conflictClass: "surface", reason: "stale", retryable: true },
      { mutation: { ...entry, mutationId: "m2" }, conflictClass: "surface", reason: "Låst post", retryable: false },
    ]);
    const log: string[] = [];
    const off = rejectedChanges.setHandlers({
      retry: async (c) => { log.push(`retry:${c.id}`); },
      restore: async (c) => { log.push(`restore:${c.id}`); },
    });
    render(<SyncConflictsPage />);
    expect(screen.getByRole("heading", { name: "Avvisade ändringar" })).toBeInTheDocument();
    expect(screen.getAllByTestId("rejected-change")).toHaveLength(2);
    // Bara den som kan lyckas erbjuds ett nytt försök.
    expect(screen.getAllByRole("button", { name: "Försök igen" })).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Försök igen" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Kasta" })); });
    await waitFor(() => expect(screen.getByText(/Inga avvisade ändringar/)).toBeInTheDocument());
    expect(log).toEqual(["retry:m1", "restore:m2"]);
    off();
  });
});
