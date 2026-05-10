/**
 * Test för Dashboard-sidan.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Dashboard from "@/app/page";

const contactsQuery = {
  data: undefined as Record<string, unknown> | undefined,
};
const mattersQuery = {
  data: undefined as Record<string, unknown> | undefined,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    contacts: {
      list: { useQuery: () => contactsQuery },
    },
    matter: {
      list: { useQuery: () => mattersQuery },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  contactsQuery.data = undefined;
  mattersQuery.data = undefined;
});

describe("Dashboard", () => {
  it("renderar utan krasch och visar rubrik + tre paneler", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByText("Kontakter")).toBeInTheDocument();
    expect(screen.getAllByText("Aktiva ärenden").length).toBeGreaterThan(0);
    expect(screen.getByText("Snabblänkar")).toBeInTheDocument();
  });

  it("visar '...' för totaler när data saknas", () => {
    render(<Dashboard />);
    const placeholders = screen.getAllByText("...");
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
  });

  it("visar tomt-läge när listor är tomma", () => {
    contactsQuery.data = { contacts: [], total: 0 };
    mattersQuery.data = { matters: [], total: 0 };
    render(<Dashboard />);
    expect(screen.getByText(/Inga kontakter ännu/i)).toBeInTheDocument();
    expect(screen.getByText(/Inga aktiva ärenden/i)).toBeInTheDocument();
  });

  it("listar kontakter och ärenden när data finns", () => {
    contactsQuery.data = {
      total: 2,
      contacts: [
        { id: "c1", name: "Anna", contactType: "PERSON", _count: { matterLinks: 3 } },
        { id: "c2", name: "Bolaget AB", contactType: "COMPANY", _count: { matterLinks: 1 } },
      ],
    };
    mattersQuery.data = {
      total: 1,
      matters: [
        {
          id: "m1",
          matterNumber: "2026-0001",
          title: "Bodelning",
          contacts: [{ contact: { name: "Anna" } }],
          _count: { documents: 2, timeEntries: 5 },
        },
      ],
    };
    render(<Dashboard />);
    expect(screen.getByText("Anna")).toBeInTheDocument();
    expect(screen.getByText("Bolaget AB")).toBeInTheDocument();
    expect(screen.getByText(/2026-0001 — Bodelning/)).toBeInTheDocument();
    expect(screen.getByText(/Person · 3 ärenden/)).toBeInTheDocument();
    expect(screen.getByText(/Företag · 1 ärenden/)).toBeInTheDocument();
  });

  it("visar 'Ingen klient' när matter saknar kontakter", () => {
    contactsQuery.data = { total: 0, contacts: [] };
    mattersQuery.data = {
      total: 1,
      matters: [
        {
          id: "m1",
          matterNumber: "2026-0002",
          title: "Tvist",
          contacts: [],
          _count: { documents: 0, timeEntries: 0 },
        },
      ],
    };
    render(<Dashboard />);
    expect(screen.getByText(/Ingen klient/)).toBeInTheDocument();
  });

  it("har snabblänkar till nya kontakter, ärenden och jävskontroll", () => {
    render(<Dashboard />);
    expect(screen.getByRole("link", { name: /Ny kontakt/i })).toHaveAttribute(
      "href",
      "/contacts?new=1",
    );
    expect(screen.getByRole("link", { name: /Nytt ärende/i })).toHaveAttribute(
      "href",
      "/matters?new=1",
    );
    expect(screen.getByRole("link", { name: /Jävskontroll/i })).toHaveAttribute(
      "href",
      "/conflicts",
    );
  });
});
