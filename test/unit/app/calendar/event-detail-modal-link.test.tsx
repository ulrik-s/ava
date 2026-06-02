/**
 * Regressionsskydd: matter-länken i EventDetailModal måste vara en HÅRD
 * <a href> via <EntityLink> (INTE en Next-<Link>). Ärenden kan skapas i
 * körande demo → deras id:n finns inte i generateStaticParams; en Next-Link
 * soft-nav till ett sådant id kraschar med React #418. EntityLink hård-navar
 * så 404-shimmen/nginx try_files löser id:t. entityHref prefixar base-path
 * MEDVETET (eftersom <a> kringgår Next:s router) + trailing slash. Se
 * docs/architecture.md ("Routing till runtime-skapade id:n").
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
  it("renderar matter-länken som hård <a href> via EntityLink (shim-säker)", () => {
    render(<EventDetailModal event={EV} userName="Anna" onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /2026-0001/ });
    // Hård <a> (inte Next-Link) med trailing slash → 404-shim/__shell__ kan
    // lösa runtime-skapade ärende-id:n. Base-path är tomt i testmiljön.
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/matters/m-001/");
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
