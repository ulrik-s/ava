/**
 * Test för SuggestionsPanel — rendering, accept/reject, dedup-grupper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestionsPanel } from "@/components/matter/suggestions-panel";

type Group = {
  key: string;
  name: string;
  contactType: string;
  roles: string[];
  personalNumber: string | null;
  orgNumber: string | null;
  email: string | null;
  phone: string | null;
  notes: string[];
  documents: Array<{ title: string | null; fileName: string }>;
  suggestionIds: string[];
};

const groupsQuery = {
  data: [] as Group[],
  isLoading: false,
};

const utilsMock = {
  document: {
    pendingSuggestionsGrouped: { invalidate: vi.fn() },
    pendingSuggestions: { invalidate: vi.fn() },
  },
  matter: { getById: { invalidate: vi.fn() } },
};

const acceptMutate = vi.fn();
const rejectMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    document: {
      pendingSuggestionsGrouped: { useQuery: () => groupsQuery },
      acceptSuggestionGroup: {
        useMutation: () => ({ mutate: acceptMutate, isPending: false }),
      },
      rejectSuggestionGroup: {
        useMutation: () => ({ mutate: rejectMutate, isPending: false }),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  groupsQuery.data = [];
  groupsQuery.isLoading = false;
});

const baseGroup = (overrides: Partial<Group> = {}): Group => ({
  key: "g1",
  name: "Anna Andersson",
  contactType: "PERSON",
  roles: ["KLIENT"],
  personalNumber: "19800101-1234",
  orgNumber: null,
  email: "anna@example.com",
  phone: "070-000",
  notes: [],
  documents: [{ title: "Stämning", fileName: "x.pdf" }],
  suggestionIds: ["s1"],
  ...overrides,
});

describe("SuggestionsPanel", () => {
  it("renderar inget vid isLoading", () => {
    groupsQuery.isLoading = true;
    const { container } = render(<SuggestionsPanel matterId="m1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renderar inget när inga förslag finns", () => {
    groupsQuery.data = [];
    const { container } = render(<SuggestionsPanel matterId="m1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renderar gruppnamn, roll och kontaktdata", () => {
    groupsQuery.data = [baseGroup()];
    render(<SuggestionsPanel matterId="m1" />);
    expect(screen.getByText("Anna Andersson")).toBeInTheDocument();
    expect(screen.getByText(/Klient/i)).toBeInTheDocument();
    expect(screen.getByText(/19800101-1234/)).toBeInTheDocument();
    expect(screen.getByText(/anna@example.com/)).toBeInTheDocument();
  });

  it("visar antal i headern matchande list.length", () => {
    groupsQuery.data = [baseGroup({ key: "a" }), baseGroup({ key: "b", name: "B" })];
    render(<SuggestionsPanel matterId="m1" />);
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("visar källdokument-titel när det finns", () => {
    groupsQuery.data = [baseGroup()];
    render(<SuggestionsPanel matterId="m1" />);
    expect(screen.getByText(/Från: Stämning/)).toBeInTheDocument();
  });

  it("visar flera roller på samma kontakt (dedup-fall)", () => {
    groupsQuery.data = [baseGroup({ roles: ["KLIENT", "MOTPART"] })];
    render(<SuggestionsPanel matterId="m1" />);
    // Knapptexten reflekterar antal roller
    expect(screen.getByRole("button", { name: /Godkänn \(2 roller\)/ })).toBeInTheDocument();
  });

  it("klick på Godkänn anropar acceptGroup.mutate med suggestionIds", () => {
    groupsQuery.data = [baseGroup({ suggestionIds: ["s1", "s2"] })];
    render(<SuggestionsPanel matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /Godkänn/ }));
    expect(acceptMutate).toHaveBeenCalledWith({ suggestionIds: ["s1", "s2"] });
  });

  it("klick på Avvisa anropar rejectGroup.mutate", () => {
    groupsQuery.data = [baseGroup({ suggestionIds: ["s1"] })];
    render(<SuggestionsPanel matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /Avvisa/ }));
    expect(rejectMutate).toHaveBeenCalledWith({ suggestionIds: ["s1"] });
  });

  it("renderar notes som listpunkter", () => {
    groupsQuery.data = [baseGroup({ notes: ["Noterad i avtal", "Bekräftad via mail"] })];
    render(<SuggestionsPanel matterId="m1" />);
    expect(screen.getByText("Noterad i avtal")).toBeInTheDocument();
    expect(screen.getByText("Bekräftad via mail")).toBeInTheDocument();
  });

  it("visar orgNumber när contactType=COMPANY", () => {
    groupsQuery.data = [
      baseGroup({
        contactType: "COMPANY",
        personalNumber: null,
        orgNumber: "556123-4567",
      }),
    ];
    render(<SuggestionsPanel matterId="m1" />);
    expect(screen.getByText(/Orgnr: 556123-4567/)).toBeInTheDocument();
  });
});
