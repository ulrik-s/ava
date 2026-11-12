/**
 * Tester för MatterTypeField (#1521) — ärendetypen i ärendehuvudet: fetstil,
 * inline-redigerbar, byråns ärendetyper som förslag men fritext tillåten.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { MatterTypeField } from "@/app/matters/[id]/_matter-type-field";
import { asId } from "@/lib/shared/schemas/ids";

const updateMutate = vi.fn();
const invalidate = vi.fn();
const settings: { data: { matterTypes: string[] } | undefined } = { data: undefined };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ matter: { getById: { invalidate } } }),
    organization: { getSettings: { useQuery: () => settings } },
    matter: {
      update: {
        useMutation: (o?: { onSuccess?: () => void }) => ({ mutate: (a: unknown) => { updateMutate(a); o?.onSuccess?.(); }, isPending: false }),
      },
    },
  },
}));

beforeEach(() => { vi.clearAllMocks(); settings.data = undefined; });

const MID = asId<"MatterId">("m1");
const typeInput = () => screen.getByLabelText("Ärendetyp");

describe("MatterTypeField", () => {
  it("visar ärendetypen i fetstil; Spara syns först vid ändring", () => {
    render(<MatterTypeField matterId={MID} value="Bodelning" />);
    expect(typeInput()).toHaveValue("Bodelning");
    expect(typeInput()).toHaveClass("font-bold");
    expect(screen.queryByRole("button", { name: "Spara ärendetyp" })).not.toBeInTheDocument();
  });

  it("byråns ärendetyper erbjuds som förslag i en datalist", () => {
    settings.data = { matterTypes: ["Bodelning", "Brottmål"] };
    const { container } = render(<MatterTypeField matterId={MID} value="" />);
    const listId = typeInput().getAttribute("list");
    expect(listId).toBeTruthy();
    const options = [...container.querySelectorAll(`datalist option`)].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Bodelning", "Brottmål"]);
    expect(container.querySelector("datalist")?.id).toBe(listId);
  });

  it("utan byråns typer: ingen datalist (bara fritext)", () => {
    const { container } = render(<MatterTypeField matterId={MID} value="" />);
    expect(typeInput()).not.toHaveAttribute("list");
    expect(container.querySelector("datalist")).toBeNull();
  });

  it("ärende utan typ får en ur listan; sparas via matter.update och hämtas om", () => {
    settings.data = { matterTypes: ["Bodelning"] };
    render(<MatterTypeField matterId={MID} value="" />);
    fireEvent.change(typeInput(), { target: { value: "Bodelning" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara ärendetyp" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "m1", matterType: "Bodelning" });
    expect(invalidate).toHaveBeenCalledWith({ id: "m1" });
  });

  it("fritt skriven typ accepteras (läggs inte till i byråns lista)", () => {
    settings.data = { matterTypes: ["Bodelning"] };
    render(<MatterTypeField matterId={MID} value="Bodelning" />);
    fireEvent.change(typeInput(), { target: { value: "Egen typ" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara ärendetyp" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith({ id: "m1", matterType: "Egen typ" });
  });

  it("tömt fält sparas som tom sträng (servern tar inte null för ärendetyp)", () => {
    render(<MatterTypeField matterId={MID} value="Bodelning" />);
    fireEvent.change(typeInput(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara ärendetyp" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "m1", matterType: "" });
  });
});
