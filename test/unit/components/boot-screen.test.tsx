/**
 * Uppstartsskärmarna (#1391): ett fel innan tRPC-klienten finns visas direkt,
 * och en uppstart som dröjer säger till i stället för att hänga på "Laddar…".
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { LoadingScreen, PendingBootScreen } from "@/components/shell/boot-screen";

describe("PendingBootScreen", () => {
  it("fel före klienten: meddelandet och 'Försök igen' (laddar om)", () => {
    const reload = vi.fn();
    render(<PendingBootScreen status="error" errorMsg="Inte behörig: ditt konto (a@b.se) finns inte i byrån — kontakta administratören." reload={reload} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("AVA kunde inte starta");
    expect(alert).toHaveTextContent("ditt konto (a@b.se) finns inte i byrån — kontakta administratören");
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("fel utan meddelande: ett generiskt besked", () => {
    render(<PendingBootScreen status="error" errorMsg={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Okänt fel.");
  });

  it("laddar: 'Laddar…' tills tidsgränsen, sedan ett besked med 'Försök igen'", async () => {
    const reload = vi.fn();
    render(<PendingBootScreen status="loading" errorMsg={null} timeoutMs={20} reload={reload} />);
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AVA startar inte");
    expect(alert).toHaveTextContent("Servern eller nätet svarar inte");
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("standard-omladdningen laddar om sidan", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      render(<PendingBootScreen status="error" errorMsg="x" />);
      fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("klar (utan klient — skip-auth-sidor): ingen tidsgräns, bara platshållaren", async () => {
    render(<PendingBootScreen status="ready" errorMsg={null} timeoutMs={5} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
  });
});

describe("LoadingScreen", () => {
  it("visar AVA och Laddar…", () => {
    render(<LoadingScreen />);
    expect(screen.getByText("AVA")).toBeInTheDocument();
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
  });
});
