/**
 * Render-tester för DayView (#27 coverage) — dag-vyns komponent: rubrik,
 * heldags-/frist-sektion, timade event-block, navigering (föreg/idag/nästa)
 * och klick → onSelectEvent. Pure-helpers täcks separat i day-view-helpers.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DayView, type DayEvent } from "@/app/calendar/_day-view";

const listQuery = { data: [] as DayEvent[], isLoading: false };
vi.mock("@/lib/client/trpc", () => ({
  trpc: { calendar: { listForUsers: { useQuery: () => listQuery } } },
}));

const anchor = new Date(2026, 3, 15, 12, 0); // 15 april 2026, lokal
const baseProps = {
  anchor,
  onAnchorChange: vi.fn(),
  userIds: ["u1"] as const,
  userNames: { u1: "Anna" },
  onSelectEvent: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  listQuery.data = [];
  listQuery.isLoading = false;
});

describe("DayView", () => {
  it("visar datum-rubrik + event-räknare (0 event)", () => {
    render(<DayView {...baseProps} />);
    expect(screen.getByText(/april/i)).toBeInTheDocument();
    expect(screen.getByText("0 event")).toBeInTheDocument();
  });

  it("visar 'Laddar…' under laddning", () => {
    listQuery.isLoading = true;
    render(<DayView {...baseProps} />);
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
  });

  it("renderar ett timat event som block med titel + tid, klick → onSelectEvent", () => {
    listQuery.data = [{
      id: "e1", userId: "u1", title: "Möte med klient",
      startAt: new Date(2026, 3, 15, 9, 0), endAt: new Date(2026, 3, 15, 10, 0),
      allDay: false, kind: "appointment",
    }];
    render(<DayView {...baseProps} />);
    expect(screen.getByText("Möte med klient")).toBeInTheDocument();
    expect(screen.getByText("1 event")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Möte med klient"));
    expect(baseProps.onSelectEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });

  it("frister/heldag hamnar i 'Heldag / Frister'-sektionen", () => {
    listQuery.data = [{
      id: "d1", userId: "u1", title: "Svarsfrist", startAt: new Date(2026, 3, 15, 0, 0),
      endAt: null, allDay: false, kind: "deadline",
    }];
    render(<DayView {...baseProps} />);
    expect(screen.getByText(/Heldag \/ Frister/i)).toBeInTheDocument();
    expect(screen.getByText("Svarsfrist")).toBeInTheDocument();
  });

  it("navigering: föregående/nästa/idag → onAnchorChange", () => {
    render(<DayView {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Föregående dag"));
    fireEvent.click(screen.getByLabelText("Nästa dag"));
    fireEvent.click(screen.getByRole("button", { name: "Idag" }));
    expect(baseProps.onAnchorChange).toHaveBeenCalledTimes(3);
  });
});
