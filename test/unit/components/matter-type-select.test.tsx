/**
 * Komponenttest för MatterTypeSelect (#1563): byråns ärendetyper i en
 * rullgardinsmeny med "Välj ärendetyp…" först.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { MatterTypeSelect } from "@/components/matter/matter-type-select";

const TYPES = ["Bodelning", "God man"];
const select = () => screen.getByLabelText("Ärendetyp");

describe("MatterTypeSelect", () => {
  it("listar byråns typer med Välj ärendetyp… först", () => {
    render(<MatterTypeSelect value="" types={TYPES} onChange={vi.fn()} />);
    expect(select().tagName).toBe("SELECT");
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Välj ärendetyp…", "Bodelning", "God man"]);
    expect(select()).toHaveValue("");
  });

  it("visar vald typ", () => {
    render(<MatterTypeSelect value="God man" types={TYPES} onChange={vi.fn()} />);
    expect(select()).toHaveValue("God man");
  });

  it("val anropar onChange med typen", () => {
    const onChange = vi.fn();
    render(<MatterTypeSelect value="" types={TYPES} onChange={onChange} />);
    fireEvent.change(select(), { target: { value: "Bodelning" } });
    expect(onChange).toHaveBeenCalledWith("Bodelning");
  });

  it("okänt värde ger valt förstaval", () => {
    render(<MatterTypeSelect value="Egen typ" types={TYPES} onChange={vi.fn()} />);
    expect(select()).toHaveValue("");
    expect(screen.queryByRole("option", { name: "Egen typ" })).not.toBeInTheDocument();
  });
});
