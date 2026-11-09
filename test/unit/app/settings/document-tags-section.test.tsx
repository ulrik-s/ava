/**
 * Tester för `DocumentTagsSection` (#621) — org-vokabulären för dokument-
 * etiketter. Verifierar add/remove → `organization.updateSettings`.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DocumentTagsSection, MatterTypesSection } from "@/app/settings/_document-tags-section";

const updateMutate = vi.fn();
const getSettingsInvalidate = vi.fn();
let documentTags: string[] = ["Sekretess"];
let matterTypes: string[] = ["Bodelning"];

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ organization: { getSettings: { invalidate: getSettingsInvalidate } } }),
    organization: {
      getSettings: { useQuery: () => ({ data: { documentTags, matterTypes } }) },
      updateSettings: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  documentTags = ["Sekretess"];
  matterTypes = ["Bodelning"];
});

describe("DocumentTagsSection", () => {
  it("renderar vokabulären som chips", () => {
    render(<DocumentTagsSection />);
    expect(screen.getByText("Sekretess")).toBeInTheDocument();
  });

  it("lägga till etikett anropar updateSettings med utökad lista", () => {
    render(<DocumentTagsSection />);
    fireEvent.change(screen.getByPlaceholderText(/Ny etikett/), { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "Lägg till" }));
    expect(updateMutate).toHaveBeenCalledWith({ documentTags: ["Sekretess", "Original"] });
  });

  it("dubblett läggs inte till", () => {
    render(<DocumentTagsSection />);
    fireEvent.change(screen.getByPlaceholderText(/Ny etikett/), { target: { value: "Sekretess" } });
    fireEvent.click(screen.getByRole("button", { name: "Lägg till" }));
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("ta bort etikett anropar updateSettings utan den", () => {
    documentTags = ["Sekretess", "Original"];
    render(<DocumentTagsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort Sekretess" }));
    expect(updateMutate).toHaveBeenCalledWith({ documentTags: ["Original"] });
  });

  it("tom vokabulär → visar tomtext", () => {
    documentTags = [];
    render(<DocumentTagsSection />);
    expect(screen.getByText("Inga etiketter ännu.")).toBeInTheDocument();
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
