/**
 * Test för NewTemplatePage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NewTemplatePage from "@/app/templates/new/page";

const routerPush = vi.fn();
const utilsMock = { documentTemplate: { list: { invalidate: vi.fn() } } };
const createMutate = vi.fn();
let onSuccessCb: (() => void) | null = null;
const createState = {
  isPending: false,
  error: null as null | { message: string },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/client/lib/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    documentTemplate: {
      create: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          onSuccessCb = opts?.onSuccess ?? null;
          return {
            mutate: createMutate,
            isPending: createState.isPending,
            error: createState.error,
          };
        },
      },
    },
  },
}));

vi.mock("@/components/settings/template-editor", () => ({
  TemplateEditor: ({
    onSave,
    onCancel,
    saving,
  }: {
    onSave: (d: { name: string; description: string; category: string; content: string }) => void;
    onCancel: () => void;
    saving: boolean;
  }) => (
    <div data-testid="template-editor">
      <button
        onClick={() =>
          onSave({ name: "Ny", description: "", category: "", content: "<p/>" })
        }
      >
        save
      </button>
      <button onClick={onCancel}>cancel</button>
      {saving && <span>sparar</span>}
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  createState.isPending = false;
  createState.error = null;
});

describe("NewTemplatePage", () => {
  it("renderar rubrik och editor", () => {
    render(<NewTemplatePage />);
    expect(
      screen.getByRole("heading", { name: /Ny dokumentmall/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("template-editor")).toBeInTheDocument();
  });

  it("anropar create-mutation vid save", () => {
    render(<NewTemplatePage />);
    fireEvent.click(screen.getByText("save"));
    expect(createMutate).toHaveBeenCalledWith({
      name: "Ny",
      description: "",
      category: "",
      content: "<p/>",
    });
  });

  it("navigerar tillbaka till /templates vid cancel", () => {
    render(<NewTemplatePage />);
    fireEvent.click(screen.getByText("cancel"));
    expect(routerPush).toHaveBeenCalledWith("/templates");
  });

  it("visar 'sparar' när mutation pending", () => {
    createState.isPending = true;
    render(<NewTemplatePage />);
    expect(screen.getByText("sparar")).toBeInTheDocument();
  });

  it("visar felmeddelande från servern", () => {
    createState.error = { message: "Något gick fel" };
    render(<NewTemplatePage />);
    expect(screen.getByText("Något gick fel")).toBeInTheDocument();
  });

  it("invaliderar listan och navigerar till /templates vid lyckad create", () => {
    render(<NewTemplatePage />);
    expect(onSuccessCb).not.toBeNull();
    onSuccessCb!();
    expect(utilsMock.documentTemplate.list.invalidate).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/templates");
  });
});
