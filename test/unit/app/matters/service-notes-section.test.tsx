/**
 * Test för ServiceNotesSection (#348) — tjänsteanteckningar-panelen:
 * tomtillstånd, lista (sorterad fallande på datum+tid med författare),
 * öppna/avbryt formulär och skapa-flödet.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ServiceNotesSection } from "@/app/matters/[id]/_service-notes-section";

const listQuery = { data: [] as unknown[], isLoading: false };
const createMutate = vi.fn();
let createOnSuccess: (() => void) | undefined;
const invalidate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ serviceNote: { list: { invalidate } } }),
    serviceNote: {
      list: { useQuery: () => listQuery },
      create: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          createOnSuccess = opts?.onSuccess;
          return { mutate: (a: unknown) => createMutate(a), isPending: false };
        },
      },
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
    render(<ServiceNotesSection matterId="m1" />);
    expect(screen.getByText("Tjänsteanteckningar")).toBeInTheDocument();
    expect(screen.getByText(/Inga tjänsteanteckningar ännu/)).toBeInTheDocument();
  });

  it("renderar anteckningar med författare, sorterade senaste först", () => {
    listQuery.data = [
      { id: "a", date: "2026-06-10", time: "08:00", text: "Äldre", author: { name: "Anna" } },
      { id: "b", date: "2026-06-15", time: "14:00", text: "Nyare", author: { name: "Björn" } },
    ];
    render(<ServiceNotesSection matterId="m1" />);
    const texts = screen.getAllByText(/Äldre|Nyare/).map((e) => e.textContent);
    expect(texts).toEqual(["Nyare", "Äldre"]); // fallande på datum+tid
    expect(screen.getByText(/Björn/)).toBeInTheDocument();
  });

  it("'+ Ny anteckning' öppnar formuläret, Avbryt stänger det", () => {
    render(<ServiceNotesSection matterId="m1" />);
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    expect(screen.getByPlaceholderText(/Vad hände/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByPlaceholderText(/Vad hände/)).not.toBeInTheDocument();
  });

  it("submit skickar create med matterId + text och invaliderar listan vid success", () => {
    render(<ServiceNotesSection matterId="m1" />);
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    fireEvent.change(screen.getByPlaceholderText(/Vad hände/), { target: { value: "Ringde klienten" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1", text: "Ringde klienten" }));
    createOnSuccess?.(); // simulera lyckad mutation
    expect(invalidate).toHaveBeenCalledWith({ matterId: "m1" });
  });

  it("submit utan text gör ingen mutation (required + trim-vakt)", () => {
    render(<ServiceNotesSection matterId="m1" />);
    fireEvent.click(screen.getByText("+ Ny anteckning"));
    const form = screen.getByPlaceholderText(/Vad hände/).closest("form")!;
    fireEvent.submit(form);
    expect(createMutate).not.toHaveBeenCalled();
  });
});
