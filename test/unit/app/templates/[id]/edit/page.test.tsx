/**
 * Test för EditTemplatePage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EditTemplatePage from "@/app/templates/[id]/edit/page";

const routerPush = vi.fn();
const utilsMock = {
  documentTemplate: {
    list: { invalidate: vi.fn() },
    getById: { invalidate: vi.fn() },
  },
};
const templateQuery = {
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
};
const updateMutate = vi.fn();
let updateOnSuccess: (() => void) | null = null;
const updateState = {
  isPending: false,
  error: null as null | { message: string },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    documentTemplate: {
      getById: { useQuery: () => templateQuery },
      update: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          updateOnSuccess = opts?.onSuccess ?? null;
          return {
            mutate: updateMutate,
            isPending: updateState.isPending,
            error: updateState.error,
          };
        },
      },
    },
  },
}));

vi.mock("@/components/template-editor", () => ({
  TemplateEditor: ({
    initialName,
    onSave,
    onCancel,
    saving,
  }: {
    initialName: string;
    onSave: (d: { name: string; description: string; category: string; content: string }) => void;
    onCancel: () => void;
    saving: boolean;
  }) => (
    <div data-testid="template-editor">
      <span data-testid="initial-name">{initialName}</span>
      <button
        onClick={() =>
          onSave({ name: "Uppdaterad", description: "d", category: "c", content: "<p/>" })
        }
      >
        save
      </button>
      <button onClick={onCancel}>cancel</button>
      {saving && <span>sparar</span>}
    </div>
  ),
}));

function makeParams(value: { id: string }) {
  const p = Promise.resolve(value) as Promise<{ id: string }> & {
    status?: string;
    value?: { id: string };
  };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

const params = makeParams({ id: "t1" });

const renderPage = () =>
  render(
    <Suspense fallback={<div>laddar</div>}>
      <EditTemplatePage params={params} />
    </Suspense>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  templateQuery.data = {
    id: "t1",
    name: "Fullmakt",
    description: "Klientfullmakt",
    category: "Fullmakter",
    content: "<p>hej</p>",
  };
  templateQuery.isLoading = false;
  updateState.isPending = false;
  updateState.error = null;
});

describe("EditTemplatePage", () => {
  it("visar laddartext under loading", async () => {
    templateQuery.isLoading = true;
    templateQuery.data = undefined;
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Laddar/i)).toBeInTheDocument(),
    );
  });

  it("visar fel när mall inte hittas", async () => {
    templateQuery.data = undefined;
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Mallen hittades inte/i)).toBeInTheDocument(),
    );
  });

  it("renderar editor med initialvärden från mall", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("template-editor")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("initial-name")).toHaveTextContent("Fullmakt");
    expect(
      screen.getByRole("heading", { name: /Redigera mall/i }),
    ).toBeInTheDocument();
  });

  it("anropar update-mutation med id vid save", async () => {
    renderPage();
    const btn = await waitFor(() => screen.getByText("save"));
    fireEvent.click(btn);
    expect(updateMutate).toHaveBeenCalledWith({
      id: "t1",
      name: "Uppdaterad",
      description: "d",
      category: "c",
      content: "<p/>",
    });
  });

  it("navigerar tillbaka till /templates vid cancel", async () => {
    renderPage();
    const btn = await waitFor(() => screen.getByText("cancel"));
    fireEvent.click(btn);
    expect(routerPush).toHaveBeenCalledWith("/templates");
  });

  it("visar felmeddelande från servern", async () => {
    updateState.error = { message: "Update misslyckades" };
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Update misslyckades")).toBeInTheDocument(),
    );
  });

  it("invaliderar och navigerar vid lyckad update", async () => {
    renderPage();
    await waitFor(() => screen.getByTestId("template-editor"));
    expect(updateOnSuccess).not.toBeNull();
    updateOnSuccess!();
    expect(utilsMock.documentTemplate.list.invalidate).toHaveBeenCalled();
    expect(utilsMock.documentTemplate.getById.invalidate).toHaveBeenCalledWith({ id: "t1" });
    expect(routerPush).toHaveBeenCalledWith("/templates");
  });
});
