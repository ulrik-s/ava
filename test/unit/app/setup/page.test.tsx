/**
 * Test för SetupPage — provisionerings-flödet för self-hosted AVA.
 *
 * Stage:n avgörs av firma-config (localStorage `ava.firma`) vid mount:
 *   token satt → "done"; tier=demo → "demo"; annars → paste-PAT-formuläret.
 * Paste-submit sparar PAT + identitet och växlar till klar-läget.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import SetupPage from "@/app/setup/page";

// createAuthClient() pratar nätverk i probeAuthServer — stubba bort så testen
// är deterministisk (hasAuthServer = false, "Avancerat" visas inte).
vi.mock("@/lib/client/auth/auth-client", () => ({
  createAuthClient: () => ({ status: vi.fn().mockRejectedValue(new Error("no auth server")) }),
}));

const STORAGE_KEY = "ava.firma";

beforeEach(() => {
  window.localStorage.clear();
});

describe("SetupPage", () => {
  it("tier=demo → visar demo-läge-info", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tier: "demo" }));
    render(<SetupPage />);
    expect(await screen.findByText(/Demo-läge/i)).toBeInTheDocument();
  });

  it("token satt → 'redan inloggad'", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tier: "self-hosted", token: "abc123" }));
    render(<SetupPage />);
    expect(await screen.findByText(/redan inloggad/i)).toBeInTheDocument();
  });

  it("self-hosted utan token → paste-PAT-formuläret", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tier: "self-hosted" }));
    render(<SetupPage />);
    expect(await screen.findByText(/Klistra in den nedan/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("anna@firma.se")).toBeInTheDocument();
  });

  it("paste-submit utan email/PAT → felmeddelande, ingen config sparas", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tier: "self-hosted" }));
    render(<SetupPage />);
    const emailInput = await screen.findByPlaceholderText("anna@firma.se");
    fireEvent.submit(emailInput.closest("form")!);
    expect(await screen.findByText(/Email och PAT krävs/i)).toBeInTheDocument();
    // token får inte ha skrivits
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).token).toBeUndefined();
  });

  it("paste-submit med email + PAT → sparar config och växlar till klar-läget", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tier: "self-hosted" }));
    render(<SetupPage />);
    const emailInput = await screen.findByPlaceholderText("anna@firma.se");
    fireEvent.change(emailInput, { target: { value: "anna@firma.se" } });
    // PAT-fältet (type=password) har ingen placeholder → ta via label-texten.
    const patInput = screen.getByText("PAT (från admin)").closest("label")!.querySelector("input")!;
    fireEvent.change(patInput, { target: { value: "ghp_secret" } });
    fireEvent.submit(emailInput.closest("form")!);

    expect(await screen.findByText(/^Inloggad$/i)).toBeInTheDocument();
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
      expect(saved.token).toBe("ghp_secret");
      expect(saved.authorEmail).toBe("anna@firma.se");
    });
  });
});
