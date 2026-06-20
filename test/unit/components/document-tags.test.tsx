/**
 * Tester för `DocumentTags` (#621) — etikett-chips + "+ etikett"-meny ur
 * byråns vokabulär. Verifierar add/remove → `document.setTags`.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DocumentTags } from "@/components/documents/_document-tags";

const setTagsMutate = vi.fn();
const treeInvalidate = vi.fn();
let vocabulary: string[] = ["Sekretess", "Brådskande", "Original"];

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ document: { tree: { invalidate: treeInvalidate } } }),
    organization: { getSettings: { useQuery: () => ({ data: { documentTags: vocabulary } }) } },
    document: { setTags: { useMutation: () => ({ mutate: setTagsMutate, isPending: false }) } },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vocabulary = ["Sekretess", "Brådskande", "Original"];
});

describe("DocumentTags", () => {
  it("renderar nuvarande etiketter som chips", () => {
    render(<DocumentTags documentId="d1" matterId="m1" tags={["Sekretess"]} />);
    expect(screen.getByText("Sekretess")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ etikett" })).toBeInTheDocument();
  });

  it("'+ etikett'-menyn visar bara taggar som inte redan är satta", () => {
    render(<DocumentTags documentId="d1" matterId="m1" tags={["Sekretess"]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ etikett" }));
    expect(screen.getByRole("button", { name: "Brådskande" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Original" })).toBeInTheDocument();
    // "Sekretess" finns redan → inte i menyn (men chip:en finns kvar)
    expect(screen.getAllByText("Sekretess")).toHaveLength(1);
  });

  it("lägga till en etikett anropar setTags med den tillagda", () => {
    render(<DocumentTags documentId="d1" matterId="m1" tags={["Sekretess"]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ etikett" }));
    fireEvent.click(screen.getByRole("button", { name: "Brådskande" }));
    expect(setTagsMutate).toHaveBeenCalledWith({ documentId: "d1", tags: ["Sekretess", "Brådskande"] });
  });

  it("ta bort en etikett anropar setTags utan den", () => {
    render(<DocumentTags documentId="d1" matterId="m1" tags={["Sekretess", "Original"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ta bort etiketten Sekretess" }));
    expect(setTagsMutate).toHaveBeenCalledWith({ documentId: "d1", tags: ["Original"] });
  });

  it("inga etiketter + tom vokabulär → renderar inget", () => {
    vocabulary = [];
    const { container } = render(<DocumentTags documentId="d1" matterId="m1" tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
