/**
 * Test för TemplateEditor — formulärfält, tab-växling, variabel-sidebar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplateEditor } from "@/components/settings/template-editor";

const onSave = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  onSave.mockReset();
  onCancel.mockReset();
});

describe("TemplateEditor", () => {
  it("renderar grundfälten med initialvärden", () => {
    render(
      <TemplateEditor
        initialName="MittAvtal"
        initialDescription="Beskr"
        initialCategory="Kategori-X"
        initialContent="<p>Hej</p>"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByDisplayValue("MittAvtal")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Beskr")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kategori-X")).toBeInTheDocument();
    expect(screen.getByText(/Redigera/i)).toBeInTheDocument();
    expect(screen.getByText(/Förhandsgranskning/i)).toBeInTheDocument();
  });

  it("Spara mall är disabled när namn eller content saknas", () => {
    render(<TemplateEditor onSave={onSave} onCancel={onCancel} />);
    const saveBtn = screen.getByRole("button", { name: /Spara mall/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("Spara mall anropar onSave med trimmad data", () => {
    render(
      <TemplateEditor
        initialName="X"
        initialContent="C"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    // namnfält
    fireEvent.change(inputs[0]!, { target: { value: "  Mitt avtal  " } });
    fireEvent.click(screen.getByRole("button", { name: /Spara mall/i }));
    expect(onSave).toHaveBeenCalledWith({
      name: "Mitt avtal",
      description: "",
      category: "",
      content: "C",
    });
  });

  it("Avbryt anropar onCancel", () => {
    render(<TemplateEditor onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /^Avbryt$/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("växlar till Förhandsgranskning-tabben", () => {
    render(
      <TemplateEditor initialContent="<p>{{matter.title}}</p>" onSave={onSave} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Förhandsgranskning/i }));
    expect(screen.getByTitle(/Förhandsgranskning/i)).toBeInTheDocument();
  });

  it("Variabler-knappen visar och döljer sidebar", () => {
    render(<TemplateEditor onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /Variabler/i }));
    // Förvalt expanderade grupper: Ärende och Kontakter — variabler från dem syns
    expect(screen.getAllByText("{{matter.matterNumber}}").length).toBeGreaterThan(0);
    expect(screen.getAllByText("{{klient.name}}").length).toBeGreaterThan(0);
  });

  it("klick på en variabel infogar tagg i editorn", () => {
    render(<TemplateEditor onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /Variabler/i }));
    const variable = screen.getAllByText("{{matter.matterNumber}}")[0]!;
    fireEvent.click(variable.closest("div")!);
    const textareas = screen.getAllByRole("textbox").filter(
      (el) => el.tagName === "TEXTAREA",
    ) as HTMLTextAreaElement[];
    const editor = textareas[0]!;
    expect(editor.value).toContain("{{matter.matterNumber}}");
  });

  it("växlar/expanderar grupper i variabel-sidebaren", () => {
    render(<TemplateEditor onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /Variabler/i }));
    // Grupp "Övrigt" är inte default-expanderad
    const ovrigt = screen.getByRole("button", { name: /Övrigt/i });
    fireEvent.click(ovrigt);
    expect(screen.getByText("{{today}}")).toBeInTheDocument();
    fireEvent.click(ovrigt);
    expect(screen.queryByText("{{today}}")).not.toBeInTheDocument();
  });

  it("uppdaterar content via textarea", () => {
    render(<TemplateEditor onSave={onSave} onCancel={onCancel} />);
    const textareas = screen.getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA");
    const editor = textareas[0] as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "<h1>Hej</h1>" } });
    expect(editor.value).toBe("<h1>Hej</h1>");
  });

  it("disable-status under saving=true", () => {
    render(
      <TemplateEditor
        initialName="X"
        initialContent="C"
        onSave={onSave}
        onCancel={onCancel}
        saving
      />,
    );
    const btn = screen.getByRole("button", { name: /Sparar…/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
