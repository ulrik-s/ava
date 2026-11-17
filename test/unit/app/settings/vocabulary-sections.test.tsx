/**
 * Tester för byråns ordlistor i inställningarna: `DocumentKindsSection`
 * (ADR 0038, byråns egna dokumenttyper) och `MatterTypesSection`.
 * Verifierar add/remove → `organization.updateSettings`.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DocumentKindsSection, MatterTypesSection } from "@/app/settings/_vocabulary-sections";

const updateMutate = vi.fn();
const getSettingsInvalidate = vi.fn();
let documentKinds: string[] = ["Sekretess"];
let matterTypes: string[] = ["Bodelning"];

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ organization: { getSettings: { invalidate: getSettingsInvalidate } } }),
    organization: {
      getSettings: { useQuery: () => ({ data: { documentKinds, matterTypes } }) },
      updateSettings: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  documentKinds = ["Sekretess"];
  matterTypes = ["Bodelning"];
});

describe("DocumentKindsSection", () => {
  it("renderar byråns egna typer som chips och nämner de inbyggda", () => {
    render(<DocumentKindsSection />);
    expect(screen.getByText("Sekretess")).toBeInTheDocument();
    expect(screen.getByText(/De inbyggda finns alltid: Stämning, Kallelse/)).toBeInTheDocument();
  });

  it("lägga till typ anropar updateSettings med utökad lista", () => {
    render(<DocumentKindsSection />);
    fireEvent.change(screen.getByPlaceholderText(/Ny dokumenttyp/), { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "Lägg till" }));
    expect(updateMutate).toHaveBeenCalledWith({ documentKinds: ["Sekretess", "Original"] });
  });

  it("dubblett läggs inte till", () => {
    render(<DocumentKindsSection />);
    fireEvent.change(screen.getByPlaceholderText(/Ny dokumenttyp/), { target: { value: "Sekretess" } });
    fireEvent.click(screen.getByRole("button", { name: "Lägg till" }));
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("ta bort typ anropar updateSettings utan den", () => {
    documentKinds = ["Sekretess", "Original"];
    render(<DocumentKindsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort Sekretess" }));
    expect(updateMutate).toHaveBeenCalledWith({ documentKinds: ["Original"] });
  });

  it("tom vokabulär → visar tomtext", () => {
    documentKinds = [];
    render(<DocumentKindsSection />);
    expect(screen.getByText("Inga egna dokumenttyper ännu.")).toBeInTheDocument();
  });
});

describe("MatterTypesSection", () => {
  it("lägga till ärendetyp anropar updateSettings med utökad lista", () => {
    render(<MatterTypesSection />);
    expect(screen.getByText("Bodelning")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Ny ärendetyp/), { target: { value: "God man" } });
    fireEvent.click(screen.getByRole("button", { name: "Lägg till" }));
    expect(updateMutate).toHaveBeenCalledWith({ matterTypes: ["Bodelning", "God man"] });
  });

  it("tom lista → visar tomtext", () => {
    matterTypes = [];
    render(<MatterTypesSection />);
    expect(screen.getByText("Inga ärendetyper ännu.")).toBeInTheDocument();
  });
});
