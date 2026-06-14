/**
 * Test för OrgDefaultsSection — admin-only-gate, lista, ta bort-knapp.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { OrgDefaultsSection } from "@/components/settings/org-defaults-section";

const meQuery: { data: { role: string } | undefined } = { data: undefined };
const listQuery: { data: Array<{ id: string; key: string }>; isLoading: boolean } = {
  data: [],
  isLoading: false,
};
const clearMutate = vi.fn();
const utilsMock = { prefs: { listOrgDefaults: { invalidate: vi.fn() } } };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    user: { current: { useQuery: () => meQuery } },
    prefs: {
      listOrgDefaults: { useQuery: () => listQuery },
      clearOrgDefault: { useMutation: () => ({ mutate: clearMutate, isPending: false }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  meQuery.data = undefined;
  listQuery.data = [];
});

describe("OrgDefaultsSection", () => {
  it("blockerar non-admin med tydligt meddelande", () => {
    meQuery.data = { role: "LAWYER" };
    render(<OrgDefaultsSection />);
    expect(screen.getByText(/Endast administrat/i)).toBeInTheDocument();
  });

  it("visar tomt-meddelande för admin utan defaults", () => {
    meQuery.data = { role: "ADMIN" };
    render(<OrgDefaultsSection />);
    expect(screen.getByText(/Inga org-globala standardvyer/i)).toBeInTheDocument();
  });

  it("listar org-defaults med svensk etikett", () => {
    meQuery.data = { role: "ADMIN" };
    listQuery.data = [
      { id: "p1", key: "list.contacts" },
      { id: "p2", key: "list.matters" },
    ];
    render(<OrgDefaultsSection />);
    expect(screen.getByText("Kontakter")).toBeInTheDocument();
    expect(screen.getByText("Ärenden")).toBeInTheDocument();
  });

  it("anropar clearOrgDefault efter confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    meQuery.data = { role: "ADMIN" };
    listQuery.data = [{ id: "p1", key: "list.contacts" }];
    render(<OrgDefaultsSection />);
    fireEvent.click(screen.getByText("Ta bort"));
    expect(clearMutate).toHaveBeenCalledWith({ key: "list.contacts" });
    confirmSpy.mockRestore();
  });

  it("avbryter när användaren ångrar i confirm-dialogen", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    meQuery.data = { role: "ADMIN" };
    listQuery.data = [{ id: "p1", key: "list.contacts" }];
    render(<OrgDefaultsSection />);
    fireEvent.click(screen.getByText("Ta bort"));
    expect(clearMutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
