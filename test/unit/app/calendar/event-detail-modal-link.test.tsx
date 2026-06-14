/**
 * Regressionsskydd: matter-länken i EventDetailModal måste gå via <EntityLink>
 * till den pre-renderade __shell__-routen med ärende-id:t som ?id-query-param
 * (INTE en direkt /matters/<id>-länk). Ärenden kan skapas i körande demo → deras
 * id:n finns inte i generateStaticParams; en direkt soft-nav till ett sådant id
 * kraschar med React #418. EntityLink navar till den pre-renderade __shell__-
 * sentinellen och useRouteId/useSearchParams läser id:t. Se
 * docs/architecture.md ("Routing till runtime-skapade id:n").
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
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
  it("renderar matter-länken via EntityLink till __shell__ med ärende-id (shim-säker)", () => {
    render(<EventDetailModal event={EV} userName="Anna" onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /2026-0001/ });
    // EntityLink renderar en <a> till den pre-renderade __shell__-routen med
    // ärende-id:t som ?id-query → 404-shim/useRouteId kan lösa runtime-skapade
    // ärende-id:n. Får INTE vara en direkt /matters/<id>-länk.
    expect(link.tagName).toBe("A");
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/matters/__shell__");
    expect(href).toContain("id=m-001");
    expect(href).not.toMatch(/\/matters\/m-001(\/|$)/);
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
