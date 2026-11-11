/**
 * Tester för InsuranceReferenceField (#1511) — försäkringsreferens i
 * ärendehuvudet, bara när ett försäkringsbolag är kontakt på ärendet.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { InsuranceReferenceField } from "@/app/matters/[id]/_insurance-reference-field";
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

const MID = asId<"MatterId">("m1");
const INSURER = [{ contact: { contactType: "INSURANCE_COMPANY" } }];

describe("InsuranceReferenceField", () => {
  it("döljs när ärendet saknar försäkringsbolag", () => {
    render(<InsuranceReferenceField matterId={MID} value="" contacts={[{ contact: { contactType: "PERSON" } }]} />);
    expect(screen.queryByLabelText("Försäkringsreferens")).not.toBeInTheDocument();
  });

  it("visas med försäkringsbolag; sparar via matter.update och hämtar om", () => {
    render(<InsuranceReferenceField matterId={MID} value="" contacts={INSURER} />);
    expect(screen.queryByRole("button", { name: "Spara försäkringsreferens" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Försäkringsreferens"), { target: { value: "SK-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara försäkringsreferens" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "m1", insuranceReference: "SK-123" });
    expect(invalidate).toHaveBeenCalledWith({ id: "m1" });
  });

  it("tömt fält sparas som null (rensar referensen)", () => {
    render(<InsuranceReferenceField matterId={MID} value="SK-123" contacts={INSURER} />);
    fireEvent.change(screen.getByLabelText("Försäkringsreferens"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara försäkringsreferens" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "m1", insuranceReference: null });
  });
});
