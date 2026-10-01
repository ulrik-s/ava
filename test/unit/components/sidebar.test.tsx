/**
 * Test för Sidebar — navigation, aktiv markering, mobile drawer, lokal sign-out.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { Sidebar } from "@/components/shell/sidebar";
import { registerServerSyncFlush } from "@/lib/client/sync/server-sync-flush";

const pathnameMock = vi.fn(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

// Utloggningen (#1347) navigerar med window.location.assign: demon till
// /login, self-hosted till oauth2-proxys /oauth2/sign_out.
const assignMock = vi.fn();
const reloadMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  pathnameMock.mockReturnValue("/");
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload: reloadMock, assign: assignMock },
    configurable: true,
  });
  localStorage.clear();
});

describe("Sidebar", () => {
  it("renderar alla huvudlänkar", () => {
    render(<Sidebar />);
    // Mobile + desktop visar samma — så vi får dubbletter; firstMatch räcker
    expect(screen.getAllByText("Startsida")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Kontakter")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Ärenden")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Tidregistrering")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Rapporter")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Användare")[0]).toBeInTheDocument();
  });

  it("visar Jävskontroll överst, sedan Ärenden, före Startsida (#89)", () => {
    render(<Sidebar />);
    const texts = screen.getAllByRole("link").map((l) => l.textContent ?? "");
    const jav = texts.findIndex((t) => t.includes("Jävskontroll"));
    const arenden = texts.findIndex((t) => t.includes("Ärenden"));
    const dash = texts.findIndex((t) => t.includes("Startsida"));
    expect(jav).toBeGreaterThanOrEqual(0);
    expect(arenden).toBe(jav + 1);
    expect(arenden).toBeLessThan(dash);
  });

  it("markerar dashboard som aktiv när pathname=/", () => {
    pathnameMock.mockReturnValue("/");
    render(<Sidebar />);
    const dashboardLinks = screen.getAllByRole("link", { name: /Startsida/ });
    // Minst en aktiv (har bg-blue-50 i className)
    expect(dashboardLinks.some((l) => l.className.includes("bg-blue-50"))).toBe(true);
  });

  it("markerar Ärenden aktiv när pathname är /matters/123", () => {
    pathnameMock.mockReturnValue("/matters/123");
    render(<Sidebar />);
    const matterLinks = screen.getAllByRole("link", { name: /Ärenden/ });
    expect(matterLinks.some((l) => l.className.includes("bg-blue-50"))).toBe(true);
  });

  it("visar userName när satt", () => {
    render(<Sidebar userName="Anna Karlsson" />);
    expect(screen.getAllByText("Anna Karlsson").length).toBeGreaterThan(0);
  });

  it("rensar token + principalId och redirectar till /login vid Logga ut", async () => {
    localStorage.setItem("ava.firma", JSON.stringify({
      tier: "demo", token: "ghp_x", principalId: "u-uuid",
    }));
    render(<Sidebar />);
    const logout = screen.getAllByText("Logga ut")[0]!;
    fireEvent.click(logout);
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(expect.stringMatching(/\/login\/$/)));
    const stored = JSON.parse(localStorage.getItem("ava.firma") ?? "{}");
    expect(stored.token).toBeUndefined();
    expect(stored.principalId).toBeUndefined();
  });

  it("osynkade ändringar (#1241, #1347): dialogen frågar; 'Avbryt' → kvar, inloggad", async () => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "self-hosted", principalId: "u-uuid" }));
    const unregister = registerServerSyncFlush(async () => { throw new Error("offline"); }, () => 2);
    render(<Sidebar />);
    fireEvent.click(screen.getAllByText("Logga ut")[0]!);
    expect(await screen.findByTestId("sign-out-unsynced")).toHaveTextContent("Du har 2 osynkade ändringar.");
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    await waitFor(() => expect(screen.queryByTestId("sign-out-unsynced")).toBeNull());
    expect(assignMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("ava.firma") ?? "{}").principalId).toBe("u-uuid");
    unregister();
  });

  it("osynkade ändringar: 'Logga ut ändå' → proxyns utloggning (self-hosted)", async () => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "self-hosted", principalId: "u-uuid" }));
    const unregister = registerServerSyncFlush(async () => { throw new Error("offline"); }, () => 1);
    render(<Sidebar />);
    fireEvent.click(screen.getAllByText("Logga ut")[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Logga ut ändå" }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(expect.stringMatching(/^\/oauth2\/sign_out\?rd=/)));
    expect(JSON.parse(localStorage.getItem("ava.firma") ?? "{}").principalId).toBeUndefined();
    unregister();
  });

  it("osynkade ändringar: 'Synka' → synkar igen; når allt fram loggas man ut", async () => {
    let pending = 1;
    let online = false;
    const unregister = registerServerSyncFlush(async () => {
      if (!online) throw new Error("offline");
      pending = 0;
    }, () => pending);
    render(<Sidebar />);
    fireEvent.click(screen.getAllByText("Logga ut")[0]!);
    await screen.findByTestId("sign-out-unsynced");
    online = true;
    fireEvent.click(screen.getByRole("button", { name: "Synka" }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(expect.stringMatching(/\/login\/$/)));
    unregister();
  });

  // #1297: toppremsan låg `fixed` ovanpå statusraden och demobannern, och den
  // flytande temaknappen låg ovanpå menyknappen.
  it("toppremsan ligger i flödet (inte fixed) och har temaknappen bredvid menyknappen", () => {
    const { container } = render(<Sidebar />);
    const bar = container.querySelector("[data-mobile-topbar]");
    expect(bar).not.toBeNull();
    expect(bar?.className).not.toMatch(/\bfixed\b/);
    expect(bar?.querySelector('[data-theme-toggle="inline"]')).not.toBeNull();
    expect(bar?.querySelector('[aria-label="Öppna meny"]')).not.toBeNull();
  });

  // #1301: 768–1023 px (halv skärm i en tiling-fönsterhanterare) — ikonmeny
  // till vänster i stället för bara ☰. Toppremsan gäller bara telefon.
  it("toppremsan och mobilmenyn gäller bara under 768 px (md:hidden)", () => {
    const { container } = render(<Sidebar />);
    expect(container.querySelector("[data-mobile-topbar]")?.className).toMatch(/\bmd:hidden\b/);
  });

  it("768–1023 px: en ikonmeny (bara ikoner, med namn som tooltip) utan fäll ut-knapp", () => {
    const { container } = render(<Sidebar />);
    const rail = container.querySelector<HTMLElement>("[data-icon-sidebar]");
    expect(rail).not.toBeNull();
    expect(rail?.className).toMatch(/\bhidden\b/);
    expect(rail?.className).toMatch(/\bmd:flex\b/);
    expect(rail?.className).toMatch(/\blg:hidden\b/);
    const matters = rail?.querySelector('a[href="/matters"]');
    expect(matters?.getAttribute("title")).toBe("Ärenden");
    expect(rail?.querySelector('[aria-label="Fäll ut menyn"], [aria-label="Fäll ihop menyn"]')).toBeNull();
    expect(rail?.querySelector('[aria-label="Logga ut"]')).not.toBeNull();
  });

  it("märker <html> medan toppremsan finns (den flytande temaknappen döljs då), och tar bort märket efteråt", () => {
    const { unmount } = render(<Sidebar />);
    expect(document.documentElement.hasAttribute("data-mobile-topbar")).toBe(true);
    unmount();
    expect(document.documentElement.hasAttribute("data-mobile-topbar")).toBe(false);
  });

  it("öppnar mobil-meny vid klick på hamburgaren", () => {
    render(<Sidebar />);
    const button = screen.getByRole("button", { name: /Öppna meny/i });
    fireEvent.click(button);
    // Mobile-overlay finns nu — verifierad genom existens av "Logga ut" som dyker upp dubbelt
    expect(screen.getAllByText("Logga ut").length).toBeGreaterThanOrEqual(2);
  });

  it("stänger mobil-meny när en länk klickas", () => {
    render(<Sidebar />);
    const button = screen.getByRole("button", { name: /Öppna meny/i });
    fireEvent.click(button);
    expect(screen.getAllByText("Logga ut").length).toBeGreaterThanOrEqual(2);
    // Klicka på en länk i drawern
    const links = screen.getAllByRole("link", { name: /Kontakter/ });
    fireEvent.click(links[0]!);
    // Drawer borde nu vara stängd
    expect(screen.getAllByText("Logga ut").length).toBe(1);
  });

  it("stänger mobil-meny när användaren klickar på overlayn", () => {
    const { container } = render(<Sidebar />);
    const button = screen.getByRole("button", { name: /Öppna meny/i });
    fireEvent.click(button);
    // hitta overlay-div (har klick-handler för stängning)
    const overlay = container.querySelector(".fixed.inset-0.z-40");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(screen.getAllByText("Logga ut").length).toBe(1);
  });

  it("renderar utan userName utan att krascha (visar bara logga ut)", () => {
    render(<Sidebar />);
    // ingen p-tagg med användarnamn
    expect(screen.queryByText("Anna Karlsson")).toBeNull();
    // logga ut-knapp ska fortfarande finnas
    expect(screen.getAllByText("Logga ut").length).toBeGreaterThan(0);
  });

  it("renderar utan userName=null utan att krascha", () => {
    render(<Sidebar userName={null} />);
    expect(screen.getAllByText("Logga ut").length).toBeGreaterThan(0);
  });
});

describe("Sidebar — hopfällt ikon-läge (#1198)", () => {
  /** Den stora sidomenyn (från 1024 px) — ikonmenyn för 768–1023 px har egna länkar (#1301). */
  const desktop = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>("[data-desktop-sidebar]");
    if (!el) throw new Error("ingen desktop-sidomeny");
    return el;
  };

  it("visar fullt läge som standard med Fäll ihop-knapp", () => {
    render(<Sidebar userName="Anna Karlsson" />);
    expect(screen.getByRole("button", { name: "Fäll ihop menyn" })).toBeInTheDocument();
    expect(screen.getAllByText("Advokat CRM").length).toBe(2);
    const links = within(desktop()).getAllByRole("link", { name: "Kontakter" });
    expect(links.every((l) => l.getAttribute("title") === null)).toBe(true);
  });

  it("fäller ihop: länkar får title, namnet blir sr-only och läget sparas", () => {
    render(<Sidebar userName="Anna Karlsson" />);
    fireEvent.click(screen.getByRole("button", { name: "Fäll ihop menyn" }));
    const titled = within(desktop()).getAllByRole("link", { name: "Kontakter" }).filter((l) => l.getAttribute("title") === "Kontakter");
    expect(titled.length).toBe(1);
    expect(titled[0]!.querySelector(".sr-only")?.textContent).toBe("Kontakter");
    expect(screen.getByRole("button", { name: "Fäll ut menyn" })).toBeInTheDocument();
    // Mobil-topbaren behåller "Advokat CRM"; desktop döljer den + användarnamnet
    expect(screen.getAllByText("Advokat CRM").length).toBe(1);
    expect(screen.queryByText("Anna Karlsson")).toBeNull();
    expect(localStorage.getItem("ava.sidebar.collapsed")).toBe("true");
  });

  it("fäller ut igen och sparar false", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Fäll ihop menyn" }));
    fireEvent.click(screen.getByRole("button", { name: "Fäll ut menyn" }));
    expect(localStorage.getItem("ava.sidebar.collapsed")).toBe("false");
    expect(screen.getByRole("button", { name: "Fäll ihop menyn" })).toBeInTheDocument();
  });

  it("återställer hopfällt läge från localStorage efter mount", async () => {
    localStorage.setItem("ava.sidebar.collapsed", "true");
    render(<Sidebar />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Fäll ut menyn" })).toBeInTheDocument());
  });

  it("server-render (statisk export) ger alltid fullt läge — ingen hydreringsmismatch", () => {
    localStorage.setItem("ava.sidebar.collapsed", "true");
    const html = renderToString(<Sidebar />);
    expect(html).toContain("Fäll ihop menyn");
    expect(html).not.toContain("Fäll ut menyn");
  });

  it("avmonteras utan fel", () => {
    const { unmount } = render(<Sidebar />);
    expect(() => unmount()).not.toThrow();
  });

  it("ogiltigt lagrat värde → fullt läge", async () => {
    localStorage.setItem("ava.sidebar.collapsed", "\"ja\"");
    render(<Sidebar />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Fäll ihop menyn" })).toBeInTheDocument());
  });

  it("växlar även när localStorage.setItem kastar", () => {
    render(<Sidebar />);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    fireEvent.click(screen.getByRole("button", { name: "Fäll ihop menyn" }));
    expect(screen.getByRole("button", { name: "Fäll ut menyn" })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("ikonknappen Logga ut loggar fortfarande ut", async () => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo", token: "ghp_x", principalId: "u-uuid" }));
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Fäll ihop menyn" }));
    const logout = within(desktop()).getByRole("button", { name: "Logga ut" });
    expect(logout.getAttribute("title")).toBe("Logga ut");
    fireEvent.click(logout);
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(expect.stringMatching(/\/login\/$/)));
    const stored = JSON.parse(localStorage.getItem("ava.firma") ?? "{}");
    expect(stored.token).toBeUndefined();
  });
});
