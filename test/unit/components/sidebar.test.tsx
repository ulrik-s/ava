/**
 * Test för Sidebar — navigation, aktiv markering, mobile drawer, signOut.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "@/components/sidebar";

const pathnameMock = vi.fn(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

const signOutMock = vi.fn();
vi.mock("next-auth/react", () => ({
  signOut: (opts: unknown) => signOutMock(opts),
}));

beforeEach(() => {
  vi.clearAllMocks();
  pathnameMock.mockReturnValue("/");
});

describe("Sidebar", () => {
  it("renderar alla huvudlänkar", () => {
    render(<Sidebar />);
    // Mobile + desktop visar samma — så vi får dubbletter; firstMatch räcker
    expect(screen.getAllByText("Dashboard")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Kontakter")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Ärenden")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Tidregistrering")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Rapporter")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Användare")[0]).toBeInTheDocument();
  });

  it("markerar dashboard som aktiv när pathname=/", () => {
    pathnameMock.mockReturnValue("/");
    render(<Sidebar />);
    const dashboardLinks = screen.getAllByRole("link", { name: /Dashboard/ });
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

  it("anropar signOut med login-callback", () => {
    render(<Sidebar />);
    const logout = screen.getAllByText("Logga ut")[0];
    fireEvent.click(logout);
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login" });
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
    fireEvent.click(links[0]);
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
