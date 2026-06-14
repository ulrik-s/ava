/**
 * Test för EventsPanel — rendering av events, accept/dismiss, .ics-länk.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { EventsPanel } from "@/components/matter/events-panel";

type Event = {
  id: string;
  title: string;
  eventType: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  status: string;
  document: { title: string | null; fileName: string };
};

const eventsQuery = {
  data: [] as Event[],
  isLoading: false,
};

const utilsMock = {
  document: { events: { invalidate: vi.fn() } },
};

const rejectMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    document: {
      events: { useQuery: () => eventsQuery },
      rejectEvent: {
        useMutation: () => ({ mutate: rejectMutate, isPending: false }),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  eventsQuery.data = [];
  eventsQuery.isLoading = false;
});

const baseEvent = (overrides: Partial<Event> = {}): Event => ({
  id: "e1",
  title: "Huvudförhandling",
  eventType: "Förhandling",
  startAt: new Date("2099-06-15T10:00:00.000Z"),
  endAt: new Date("2099-06-15T12:00:00.000Z"),
  allDay: false,
  location: "Stockholms tingsrätt",
  description: "Sal 5",
  status: "PENDING",
  document: { title: "Kallelse", fileName: "kallelse.pdf" },
  ...overrides,
});

describe("EventsPanel", () => {
  it("renderar inget vid isLoading", () => {
    eventsQuery.isLoading = true;
    const { container } = render(<EventsPanel matterId="m1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renderar inget när events är tomt", () => {
    eventsQuery.data = [];
    const { container } = render(<EventsPanel matterId="m1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renderar event-titel, eventType och plats", () => {
    eventsQuery.data = [baseEvent()];
    render(<EventsPanel matterId="m1" />);
    expect(screen.getByText("Huvudförhandling")).toBeInTheDocument();
    expect(screen.getByText("Förhandling")).toBeInTheDocument();
    expect(screen.getByText(/Stockholms tingsrätt/)).toBeInTheDocument();
    expect(screen.getByText(/Sal 5/)).toBeInTheDocument();
  });

  it("visar 'i kalendern'-badge när status=ACCEPTED", () => {
    eventsQuery.data = [baseEvent({ status: "ACCEPTED" })];
    render(<EventsPanel matterId="m1" />);
    expect(screen.getByText(/i kalendern/)).toBeInTheDocument();
  });

  it("visar 'passerat'-badge för datum i det förflutna", () => {
    eventsQuery.data = [baseEvent({ startAt: new Date("2000-01-01"), endAt: null })];
    render(<EventsPanel matterId="m1" />);
    expect(screen.getByText(/passerat/)).toBeInTheDocument();
  });

  it(".ics-länk pekar mot /api/events/:id/ics", () => {
    eventsQuery.data = [baseEvent({ id: "evt-42" })];
    render(<EventsPanel matterId="m1" />);
    const link = screen.getByRole("link", { name: /Lägg i kalender/ });
    expect(link).toHaveAttribute("href", "/api/events/evt-42/ics");
  });

  it("klick på X-knappen anropar reject.mutate med eventId", () => {
    eventsQuery.data = [baseEvent({ id: "e7" })];
    render(<EventsPanel matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(rejectMutate).toHaveBeenCalledWith({ eventId: "e7" });
  });

  it("visar fallback-filename när document.title saknas", () => {
    eventsQuery.data = [
      baseEvent({ document: { title: null, fileName: "ladda-om.pdf" } }),
    ];
    render(<EventsPanel matterId="m1" />);
    expect(screen.getByText(/ladda-om.pdf/)).toBeInTheDocument();
  });

  it("renderar allDay-event utan tidsdel", () => {
    eventsQuery.data = [
      baseEvent({
        allDay: true,
        startAt: new Date("2099-08-20T00:00:00.000Z"),
        endAt: null,
      }),
    ];
    render(<EventsPanel matterId="m1" />);
    // No "kl XX:XX" expected
    expect(screen.queryByText(/kl \d{2}:\d{2}/)).not.toBeInTheDocument();
  });

  it("visar antal i headern", () => {
    eventsQuery.data = [
      baseEvent({ id: "a" }),
      baseEvent({ id: "b" }),
      baseEvent({ id: "c" }),
    ];
    render(<EventsPanel matterId="m1" />);
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });
});
