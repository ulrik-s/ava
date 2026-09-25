/**
 * Tester för CourtCaseNumberField (#1134) — målnummer i ärendehuvudet.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { CourtCaseNumberField } from "@/app/matters/[id]/_court-case-number-field";
import { asId } from "@/lib/shared/schemas/ids";

const updateMutate = vi.fn();
const invalidate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ matter: { getById: { invalidate } } }),
    matter: {
      update: {
        useMutation: (o?: { onSuccess?: () => void }) => ({ mutate: (a: unknown) => { updateMutate(a); o?.onSuccess?.(); }, isPending: false }),
      },
    },
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("CourtCaseNumberField", () => {
  it("Spara syns först vid ändring (kompakt huvud, #1185); sparar + hämtar om", () => {
    render(<CourtCaseNumberField matterId={asId<"MatterId">("m1")} value="T 1-26" />);
    expect(screen.queryByRole("button", { name: "Spara målnummer" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Målnummer"), { target: { value: "T 9-26" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara målnummer" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "m1", courtCaseNumber: "T 9-26" });
    expect(invalidate).toHaveBeenCalledWith({ id: "m1" });
  });

  it("tömt fält sparas som null (rensar målnumret)", () => {
    render(<CourtCaseNumberField matterId={asId<"MatterId">("m1")} value="T 1-26" />);
    fireEvent.change(screen.getByLabelText("Målnummer"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara målnummer" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "m1", courtCaseNumber: null });
  });
});
