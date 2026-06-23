/**
 * Test för ServiceNotesSection (#348) — tjänsteanteckningar-panelen:
 * tomtillstånd, lista (sorterad fallande på datum+tid med författare),
 * öppna/avbryt formulär och skapa-flödet.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ServiceNotesSection } from "@/app/matters/[id]/_service-notes-section";
import { asId } from "@/lib/shared/schemas/ids";

const listQuery = { data: [] as unknown[], isLoading: false };
const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
let createOnSuccess: (() => void) | undefined;
const invalidate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      serviceNote: { list: { invalidate } },
      prefs: { get: { invalidate: vi.fn() } },
    }),
    serviceNote: {
      list: { useQuery: () => listQuery },
      create: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          createOnSuccess = opts?.onSuccess;
          return { mutate: (a: unknown) => createMutate(a), isPending: false };
        },
      },
      update: { useMutation: () => ({ mutate: (a: unknown) => updateMutate(a), isPending: false }) },
      delete: { useMutation: () => ({ mutate: (a: unknown) => deleteMutate(a), isPending: false }) },
    },
    // DataTable-beroenden (#367): tjänsteanteckningarna renderas nu i en
    // DataTable som läser prefs + current user.
    user: { current: { useQuery: () => ({ data: { id: "u1", name: "Anna", role: "USER" } }) } },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  listQuery.data = [];
  listQuery.isLoading = false;
});

describe("ServiceNotesSection", () => {
  it("visar tomtillstånd när inga anteckningar finns", () => {
    render(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText("Tjänsteanteckningar")).toBeInTheDocument();
    expect(screen.getByText(/Inga tjänsteanteckningar ännu/)).toBeInTheDocument();
  });

  it("renderar anteckningar med författare, sorterade senaste först", () => {
    listQuery.data = [
      { id: "a", date: "2026-06-10", time: "08:00", text: "Äldre", author: { name: "Anna" } },
      { id: "b", date: "2026-06-15", time: "14:00", text: "Nyare", author: { name: "Björn" } },
    ];
    render(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />);
    const texts = screen.getAllByText(/Äldre|Nyare/).map((e) => e.textContent);
    expect(texts).toEqual(["Nyare", "Äldre"]); // fallande på datum+tid
    expect(screen.getByText(/Björn/)).toBeInTheDocument();
  });

  it("'+ Ny anteckning' öppnar formuläret, Avbryt stänger det", () => {
    render(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    expect(screen.getByPlaceholderText(/Vad hände/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByPlaceholderText(/Vad hände/)).not.toBeInTheDocument();
  });

  it("submit skickar create med matterId + text och invaliderar listan vid success", () => {
    render(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    fireEvent.change(screen.getByPlaceholderText(/Vad hände/), { target: { value: "Ringde klienten" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1", text: "Ringde klienten" }));
    createOnSuccess?.(); // simulera lyckad mutation
    expect(invalidate).toHaveBeenCalledWith({ matterId: "m1" });
  });

  it("submit utan text gör ingen mutation (required + trim-vakt)", () => {
    render(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    const form = screen.getByPlaceholderText(/Vad hände/).closest("form")!;
    fireEvent.submit(form);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("Redigera öppnar formuläret förifyllt och submit skickar update med id (#375)", () => {
    listQuery.data = [
      { id: "a", date: "2026-06-10", time: "08:00", text: "Gammal text", author: { name: "Anna" } },
    ];
    render(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByTitle("Redigera"));
    const textarea = screen.getByPlaceholderText(/Vad hände/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Gammal text"); // förifyllt
    fireEvent.change(textarea, { target: { value: "Ny text" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ id: "a", text: "Ny text" }));
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("Ta bort kallar delete med id efter confirm (#375)", () => {
    listQuery.data = [
      { id: "a", date: "2026-06-10", time: "08:00", text: "Text", author: { name: "Anna" } },
    ];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByTitle("Ta bort"));
    expect(deleteMutate).toHaveBeenCalledWith({ id: "a" });
    confirmSpy.mockRestore();
  });

  it("Ta bort gör inget om confirm avbryts (#375)", () => {
    listQuery.data = [
      { id: "a", date: "2026-06-10", time: "08:00", text: "Text", author: { name: "Anna" } },
    ];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ServiceNotesSection matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByTitle("Ta bort"));
    expect(deleteMutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
