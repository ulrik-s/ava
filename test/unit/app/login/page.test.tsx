/**
 * Tester för `/login` (#516) — demo-lägets användarväljare + self-hosted-info.
 *
 * Self-hosted: inloggning sker via OIDC (oauth2-proxy) innan appen laddas →
 * sidan visar bara en informativ hänvisning, inte den gamla "nginx
 * auth_basic"-texten.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import LoginPage from "@/app/login/page";

let tier = "demo";
vi.mock("@/lib/client/firma/firma-config", () => ({
  loadFirmaConfig: () => ({ tier, repo: "ulrik-s/ava-demo" }),
  patchFirmaConfig: vi.fn(),
}));

vi.mock("@/lib/client/demo/demo-meta", () => ({
  loadDemoMeta: vi.fn(async () => ({
    organizationName: "Demo Byrå AB",
    organizationId: "demo-firma",
    users: [
      { id: "u-anna", name: "Anna", title: "Advokat", role: "ADMIN", email: "anna@demo.se" },
      { id: "u-bo", name: "Bo", title: null, role: "LAWYER", email: "bo@demo.se" },
    ],
  })),
}));

beforeEach(() => {
  tier = "demo";
});

describe("/login", () => {
  it("demo-läge: laddar användarväljaren med konton + lösenordsfält", async () => {
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByText("Demo Byrå AB")).toBeInTheDocument());
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText(/Anna/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Logga in/ })).toBeInTheDocument();
  });

  it("self-hosted: visar OIDC-info + länk till startsidan, INTE auth_basic", async () => {
    tier = "self-hosted";
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByText(/identitetsleverantör \(OIDC\)/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Till startsidan/ })).toBeInTheDocument();
    // Den pensionerade legacy-texten ska vara borta.
    expect(screen.queryByText(/auth_basic/)).toBeNull();
    expect(screen.queryByText(/ännu ej implementerad/)).toBeNull();
    // Ingen användarväljare i self-hosted.
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
