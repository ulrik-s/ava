/**
 * Tester för `DemoModeBanner` — visas bara i tier=demo, dismissable
 * + persistar dismiss i sessionStorage.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest-compat";
import { DemoModeBanner } from "@/components/shell/demo-mode-banner";
import { saveFirmaConfig, resetToDemo } from "@/lib/client/firma/firma-config";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetToDemo();
});

describe("DemoModeBanner", () => {
  it("visas inte i self-hosted-läge (default på jsdom)", () => {
    // jsdom hostname = "localhost" → defaultConfigForHost ger self-hosted
    render(<DemoModeBanner />);
    expect(screen.queryByText(/Demo-läge/)).not.toBeInTheDocument();
  });

  it("visas när tier=demo sparats", () => {
    saveFirmaConfig({
      tier: "demo", repo: "u/r", token: "",
      organizationId: "demo-firma-ab",
      authorName: "Anna", authorEmail: "anna@ava.demo",
    });
    render(<DemoModeBanner />);
    expect(screen.getByText(/Demo-läge/)).toBeInTheDocument();
    expect(screen.getByText(/ändringar/i)).toBeInTheDocument();
  });

  it("klick på stäng-knappen döljer + persistar i sessionStorage", () => {
    saveFirmaConfig({
      tier: "demo", repo: "u/r", token: "",
      organizationId: "demo-firma-ab",
      authorName: "Anna", authorEmail: "anna@ava.demo",
    });
    render(<DemoModeBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Stäng/i }));
    expect(screen.queryByText(/Demo-läge/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem("ava.demoBannerDismissed")).toBe("1");
  });

  it("redan-dismissed via sessionStorage → visas inte", () => {
    saveFirmaConfig({
      tier: "demo", repo: "u/r", token: "",
      organizationId: "demo-firma-ab",
      authorName: "Anna", authorEmail: "anna@ava.demo",
    });
    sessionStorage.setItem("ava.demoBannerDismissed", "1");
    render(<DemoModeBanner />);
    expect(screen.queryByText(/Demo-läge/)).not.toBeInTheDocument();
  });
});
