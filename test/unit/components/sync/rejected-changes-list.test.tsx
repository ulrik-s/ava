/**
 * Vyn för avvisade ändringar (#1266): orsak på svenska, Försök igen / Kasta,
 * och ett fel syns i stället för att sväljas.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { explainReason, RejectedChangesList } from "@/components/sync/rejected-changes-list";
import { RejectedChangesNotice } from "@/components/sync/rejected-changes-notice";
import { InMemoryRejectedChangesPersistence, rejectedChanges, type RejectedChange } from "@/lib/client/backend/rejected-changes";

const change: RejectedChange = {
  id: "m1", rejectedAt: Date.UTC(2026, 8, 30, 8), label: "Slutfaktura", reason: "Posterna är redan fakturerade.",
  entry: { mutationId: "m1", entity: "invoice", kind: "update", row: { id: "i" }, enqueuedAt: 0 }, retryable: true,
};

describe("explainReason", () => {
  it("tekniska koder på svenska; serverns egna besked står kvar", () => {
    expect(explainReason("stale")).toMatch(/Någon annan hann ändra/);
    expect(explainReason("okänd entitet: x")).toMatch(/känner inte igen/);
    expect(explainReason("Posterna är redan fakturerade.")).toBe("Posterna är redan fakturerade.");
  });
});

describe("RejectedChangesList", () => {
  it("tom lista → allt är sparat", () => {
    render(<RejectedChangesList items={[]} onRetry={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/Inga avvisade ändringar/)).toBeInTheDocument();
  });

  it("visar vad, varför och när — och knapparna gör sitt", async () => {
    const onRetry = vi.fn(async () => {});
    const onDiscard = vi.fn(async () => {});
    render(<RejectedChangesList items={[change]} onRetry={onRetry} onDiscard={onDiscard} />);
    expect(screen.getByText("Slutfaktura")).toBeInTheDocument();
    expect(screen.getByText("Posterna är redan fakturerade.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    fireEvent.click(screen.getByRole("button", { name: "Kasta" }));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith("m1"));
    expect(onRetry).toHaveBeenCalledWith("m1");
  });

  it("en ändring som avvisas igen (#1348): ingen Försök igen-knapp, men en förklaring och Kasta", async () => {
    const onDiscard = vi.fn(async () => {});
    render(<RejectedChangesList items={[{ ...change, retryable: false }]} onRetry={vi.fn()} onDiscard={onDiscard} />);
    expect(screen.queryByRole("button", { name: "Försök igen" })).toBeNull();
    expect(screen.getByText(/Avvisas igen om den skickas på nytt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kasta" }));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith("m1"));
  });

  it("ett misslyckat försök syns — sväljs inte", async () => {
    render(<RejectedChangesList items={[change]} onRetry={async () => { throw new Error("Ingen synk mot servern"); }} onDiscard={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ingen synk mot servern");
  });

  it("ett fel som inte är ett Error visas också", async () => {
    render(<RejectedChangesList items={[change]} onRetry={vi.fn()} onDiscard={() => Promise.reject("nej")} />);
    fireEvent.click(screen.getByRole("button", { name: "Kasta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nej");
  });
});

describe("RejectedChangesNotice (Att bevaka)", () => {
  it("syns bara när något väntar, och länkar till vyn", async () => {
    await rejectedChanges.attach(new InMemoryRejectedChangesPersistence());
    const { container } = render(<RejectedChangesNotice />);
    expect(container).toBeEmptyDOMElement();
    await act(async () => { await rejectedChanges.record([{ mutation: change.entry, conflictClass: "surface", reason: "stale", retryable: false }]); });
    expect(screen.getByTestId("rejected-changes-notice")).toHaveAttribute("href", "/sync-conflicts");
    expect(screen.getByTestId("rejected-changes-notice")).toHaveTextContent("1 ändring avvisades");
    await act(async () => { await rejectedChanges.record([{ mutation: { ...change.entry, mutationId: "m2" }, conflictClass: "surface", reason: "stale", retryable: false }]); });
    expect(screen.getByTestId("rejected-changes-notice")).toHaveTextContent("2 ändringar avvisades");
    const off = rejectedChanges.setHandlers({ retry: async () => {}, restore: async () => {} });
    await act(async () => { await rejectedChanges.discard("m1"); await rejectedChanges.discard("m2"); });
    off();
  });
});
