/**
 * Test för OrgDefaultsSection — admin-only-gate, lista, ta bort-knapp.
 */

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { OrgDefaultsSection } from "@/components/settings/org-defaults-section";
import { callsTo, renderWithFakeTrpc, settled, type FakeTrpcRender } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths } from "../../../helpers/trpc-fake";

let me: { role: string } | null = null;
let orgDefaults: Array<{ id: string; key: string }> = [];

/** Renderar sektionen och väntar tills frågorna svarat. */
async function renderSection(): Promise<FakeTrpcRender> {
  const view = renderWithFakeTrpc(<OrgDefaultsSection />, {
    "user.current": () => me,
    "prefs.listOrgDefaults": () => orgDefaults,
    "prefs.clearOrgDefault": () => ({ ok: true }),
  });
  await settled(view);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  me = null;
  orgDefaults = [];
});

describe("OrgDefaultsSection", () => {
  it("blockerar non-admin med tydligt meddelande", async () => {
    me = { role: "LAWYER" };
    const view = await renderSection();
    expect(screen.getByText(/Endast administrat/i)).toBeInTheDocument();
    expect(callsTo(view.fake, "prefs.listOrgDefaults")).toEqual([]);
  });

  it("visar tomt-meddelande för admin utan defaults", async () => {
    me = { role: "ADMIN" };
    await renderSection();
    expect(screen.getByText(/Inga org-globala standardvyer/i)).toBeInTheDocument();
  });

  it("listar org-defaults med svensk etikett", async () => {
    me = { role: "ADMIN" };
    orgDefaults = [
      { id: "p1", key: "list.contacts" },
      { id: "p2", key: "list.matters" },
      { id: "p3", key: "list.matters-mine" },
    ];
    await renderSection();
    expect(screen.getByText("Parter")).toBeInTheDocument();
    expect(screen.getByText("Ärenden")).toBeInTheDocument();
    expect(screen.getByText("Ärenden – Mitt aktskåp")).toBeInTheDocument();
  });

  it("anropar clearOrgDefault efter confirm och hämtar listan igen", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    me = { role: "ADMIN" };
    orgDefaults = [{ id: "p1", key: "list.contacts" }];
    const view = await renderSection();
    fireEvent.click(screen.getByText("Ta bort"));
    await waitFor(() => expect(callsTo(view.fake, "prefs.clearOrgDefault")).toEqual([{ key: "list.contacts" }]));
    await waitFor(() => expect(invalidatedPaths(view.invalidate)).toEqual(["prefs.listOrgDefaults"]));
    confirmSpy.mockRestore();
  });

  it("avbryter när användaren ångrar i confirm-dialogen", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    me = { role: "ADMIN" };
    orgDefaults = [{ id: "p1", key: "list.contacts" }];
    const view = await renderSection();
    fireEvent.click(screen.getByText("Ta bort"));
    await settled(view);
    expect(callsTo(view.fake, "prefs.clearOrgDefault")).toEqual([]);
    confirmSpy.mockRestore();
  });
});
