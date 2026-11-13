/**
 * Tester för `/login` (#516) — demo-lägets användarväljare + self-hosted-info.
 *
 * Self-hosted: inloggning sker via OIDC (oauth2-proxy) innan appen laddas →
 * sidan visar bara en informativ hänvisning, inte den gamla "nginx
 * auth_basic"-texten.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import LoginPage from "@/app/login/page";

let tier = "demo";
vi.mock("@/lib/client/firma/firma-config", () => ({
  loadFirmaConfig: () => ({ tier, repo: "ulrik-s/ava-demo" }),
  patchFirmaConfig: vi.fn(),
  forgetSignedInIdentity: vi.fn(),
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

const VERSION_ENV = ["NEXT_PUBLIC_AVA_VERSION", "NEXT_PUBLIC_AVA_VERSION_DATE"] as const;
const savedVersionEnv = VERSION_ENV.map((k) => process.env[k]);

function setVersion(version: string | undefined): void {
  if (version === undefined) {
    VERSION_ENV.forEach((k) => Reflect.deleteProperty(process.env, k));
    return;
  }
  process.env.NEXT_PUBLIC_AVA_VERSION = version;
  process.env.NEXT_PUBLIC_AVA_VERSION_DATE = "2026-11-13T08:16:45+01:00";
}

afterEach(() => {
  VERSION_ENV.forEach((k, i) => {
    const v = savedVersionEnv[i];
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = v;
  });
});

beforeEach(() => {
  tier = "demo";
  setVersion("v0.7.11");
  window.history.replaceState({}, "", "/login/");
  localStorage.clear();
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

  it("self-hosted efter utloggning (#1347): 'Du är utloggad' + Logga in igen; den väntande utloggningen avslutas", async () => {
    tier = "self-hosted";
    localStorage.setItem("ava.pendingSignOut", "1");
    window.history.replaceState({}, "", "/login/?signedOut=1");
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByText(/Du är utloggad/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Logga in igen" })).toBeInTheDocument();
    expect(localStorage.getItem("ava.pendingSignOut")).toBeNull();
  });

  it("utloggad (#1579): versionstexten syns under knappen 'Logga in igen'", async () => {
    tier = "self-hosted";
    window.history.replaceState({}, "", "/login/?signedOut=1");
    const { container } = render(<LoginPage />);
    await waitFor(() => expect(screen.getByText(/Du är utloggad/)).toBeInTheDocument());
    const version = container.querySelector("[data-app-version]");
    expect(version?.textContent).toBe("v0.7.11 · 13 nov 2026");
    if (!version) throw new Error("versionstexten saknas");
    const link = screen.getByRole("link", { name: "Logga in igen" });
    expect(link.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("utloggad utan version vid bygget: ingen versionstext", async () => {
    setVersion(undefined);
    tier = "self-hosted";
    window.history.replaceState({}, "", "/login/?signedOut=1");
    const { container } = render(<LoginPage />);
    await waitFor(() => expect(screen.getByText(/Du är utloggad/)).toBeInTheDocument());
    expect(container.querySelector("[data-app-version]")).toBeNull();
  });

  it("self-hosted utan signedOut: ingen versionstext", async () => {
    tier = "self-hosted";
    const { container } = render(<LoginPage />);
    await waitFor(() => expect(screen.getByText(/identitetsleverantör \(OIDC\)/)).toBeInTheDocument());
    expect(container.querySelector("[data-app-version]")).toBeNull();
  });

  it("demo-läge: ingen versionstext i inloggningsformuläret", async () => {
    const { container } = render(<LoginPage />);
    await waitFor(() => expect(screen.getByText("Demo Byrå AB")).toBeInTheDocument());
    expect(container.querySelector("[data-app-version]")).toBeNull();
  });
});
