/**
 * HelperSection — visar AVA Helper-status i Inställningar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, waitFor } from "@testing-library/react";
import { HelperSection } from "@/components/settings/helper-section";

const originalFetch = global.fetch;
beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
});

describe("HelperSection", () => {
  it("visar 'Kontrollerar…' först", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => { /* hänger */ }));
    render(<HelperSection />);
    expect(screen.getByText(/Kontrollerar/)).toBeInTheDocument();
  });

  it("visar version när helpern svarar", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response("ava-helper v1.0.0\n", { status: 200 })
    );
    render(<HelperSection />);
    await waitFor(() => expect(screen.getByText(/Installerad/)).toBeInTheDocument());
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("visar 'Inte installerad' när helpern saknas", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    render(<HelperSection />);
    await waitFor(() => expect(screen.getByText(/Inte installerad/)).toBeInTheDocument());
  });

  it("alltid visar länk till release-sidan", () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response("ava-helper v1.0.0\n", { status: 200 })
    );
    render(<HelperSection />);
    const link = screen.getByRole("link", { name: /Ladda ner/ });
    expect(link.getAttribute("href")).toMatch(/github\.com\/ulrik-s\/ava\/releases/);
  });
});
