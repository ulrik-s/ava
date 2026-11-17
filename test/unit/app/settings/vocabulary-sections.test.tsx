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
let publicAssignmentMatterTypes: string[] | null = null;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ organization: { getSettings: { invalidate: getSettingsInvalidate } } }),
    organization: {
      getSettings: { useQuery: () => ({ data: { documentKinds, matterTypes, publicAssignmentMatterTypes } }) },
      updateSettings: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  documentKinds = ["Sekretess"];
  matterTypes = ["Bodelning"];
  publicAssignmentMatterTypes = null;
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

  it("visar ingen kryssruta för offentligt uppdrag", () => {
    render(<DocumentKindsSection />);
    expect(screen.queryByRole("checkbox")).toBeNull();
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

/** Kryssrutan "Offentligt uppdrag" per ärendetyp (#1638). */
describe("MatterTypesSection — offentligt uppdrag", () => {
  const box = (type: string): HTMLInputElement => screen.getByRole("checkbox", { name: `Offentligt uppdrag: ${type}` });

  it("visar en kryssruta per ärendetyp, oikryssad när markeringen aldrig satts", () => {
    matterTypes = ["Bodelning", "Offentlig försvarare"];
    render(<MatterTypesSection />);
    expect(box("Bodelning").checked).toBe(false);
    expect(box("Offentlig försvarare").checked).toBe(false);
  });

  it("speglar markeringen", () => {
    matterTypes = ["Bodelning", "Offentlig försvarare"];
    publicAssignmentMatterTypes = ["Offentlig försvarare"];
    render(<MatterTypesSection />);
    expect(box("Offentlig försvarare").checked).toBe(true);
    expect(box("Bodelning").checked).toBe(false);
  });

  it("kryssa i sparar den utökade listan", () => {
    matterTypes = ["Bodelning", "Offentlig försvarare"];
    publicAssignmentMatterTypes = ["Bodelning"];
    render(<MatterTypesSection />);
    fireEvent.click(box("Offentlig försvarare"));
    expect(updateMutate).toHaveBeenCalledWith({ publicAssignmentMatterTypes: ["Bodelning", "Offentlig försvarare"] });
  });

  it("kryssa ur sparar listan utan typen", () => {
    matterTypes = ["Bodelning", "Offentlig försvarare"];
    publicAssignmentMatterTypes = ["Bodelning", "Offentlig försvarare"];
    render(<MatterTypesSection />);
    fireEvent.click(box("Bodelning"));
    expect(updateMutate).toHaveBeenCalledWith({ publicAssignmentMatterTypes: ["Offentlig försvarare"] });
  });

  it("att ta bort en ärendetyp sparar bara ärendetyperna (servern rensar markeringen)", () => {
    matterTypes = ["Bodelning", "Offentlig försvarare"];
    publicAssignmentMatterTypes = ["Offentlig försvarare"];
    render(<MatterTypesSection />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort Offentlig försvarare" }));
    expect(updateMutate).toHaveBeenCalledWith({ matterTypes: ["Bodelning"] });
  });
});
