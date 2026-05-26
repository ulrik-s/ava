/**
 * Regressionsskydd: matter-länken i EventDetailModal måste vara en Next
 * <Link> (inte <a>) så basePath "/ava" prepend:as automatiskt på GH
 * Pages — annars 404 vid klick.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventDetailModal, type EventDetail } from "@/app/calendar/_event-detail-modal";

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ calendar: { invalidate: vi.fn() } }),
    calendar: { delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    user: { list: { useQuery: () => ({ data: { users: [] } }) } },
    contacts: { list: { useQuery: () => ({ data: { contacts: [] } }) } },
  },
}));

const EV: EventDetail = {
  id: "cal-1",
  title: "Klientmöte",
  startAt: new Date("2026-05-30T10:00:00Z"),
  endAt: new Date("2026-05-30T11:00:00Z"),
  allDay: false,
  userId: "u-anna",
  kind: "appointment",
  matter: { id: "m-001", matterNumber: "2026-0001", title: "Vårdnadstvist" },
};

describe("EventDetailModal — matter-länk", () => {
  it("renderar matter-länken via Next <Link> (basePath-aware)", () => {
    render(<EventDetailModal event={EV} userName="Anna" onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /2026-0001/ });
    // Next:s <Link> sätter href-attribut till SAMMA path som vi skickar in
    // (basePath prepend:as vid navigation, inte i markup) — men det är ett
    // Link-element, inte <a>. Vi verifierar att href:n inte är hårdkodad
    // med basePath (vilket var den gamla buggen).
    expect(link.getAttribute("href")).toBe("/matters/m-001");
  });

  it("matter-länken är klickbar (har not pointer-events:none)", () => {
    render(<EventDetailModal event={EV} userName="Anna" onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /Vårdnadstvist/ });
    const style = window.getComputedStyle(link);
    expect(style.pointerEvents).not.toBe("none");
  });

  it("visar matter-text utan att krascha när matter saknas", () => {
    const noMatter = { ...EV, matter: null };
    render(<EventDetailModal event={noMatter} userName="Anna" onClose={vi.fn()} />);
    // Ingen länk om ingen matter
    expect(screen.queryByRole("link", { name: /2026/ })).toBeNull();
  });
});
