/**
 * Mappväljaren (#1974): Överst, utan mapp först, sedan ärendets mappar.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { FolderSelect, type FolderSelectFolder } from "@/components/documents/folder-select";
import { asId } from "@/lib/shared/schemas/ids";

const DOMSTOL = asId<"DocumentFolderId">("f-domstol");
const KALLELSE = asId<"DocumentFolderId">("f-kallelse");
const FOLDERS: FolderSelectFolder[] = [
  { id: KALLELSE, name: "Kallelse", parentId: DOMSTOL },
  { id: DOMSTOL, name: "Domstol", parentId: null },
];

const options = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("FolderSelect", () => {
  it("första valet är Överst, utan mapp, sedan mapparna i trädets ordning", () => {
    render(<FolderSelect folders={FOLDERS} value={null} onChange={vi.fn()} />);
    expect(options()).toEqual(["Överst, utan mapp", "Domstol", "Domstol › Kallelse"]);
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("visar vald mapp", () => {
    render(<FolderSelect folders={FOLDERS} value={KALLELSE} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue(KALLELSE);
  });

  it("ett val ger onChange med mappens id, och Överst ger null", () => {
    const onChange = vi.fn();
    render(<FolderSelect folders={FOLDERS} value={DOMSTOL} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: KALLELSE } });
    expect(onChange).toHaveBeenLastCalledWith(KALLELSE);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("utan mappar finns bara Överst, utan mapp", () => {
    render(<FolderSelect folders={[]} value={null} onChange={vi.fn()} />);
    expect(options()).toEqual(["Överst, utan mapp"]);
  });
});
