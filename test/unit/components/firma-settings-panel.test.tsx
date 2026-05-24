/**
 * Tester för `FirmaSettingsPanel` — fokus på det nya:
 * "Tillåt anonym läsning"-toggle och "Logga ut"-knappen.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FirmaSettingsPanel } from "@/client/components/firma-settings-panel";
import { loadAuthSettings, saveAuthSettings } from "@/client/lib/auth/use-auth-mode";
import type { FirmaConfig } from "@/client/lib/firma/firma-config";

const baseConfig: FirmaConfig = {
  tier: "github",
  repo: "ulrik-s/ava-demo",
  token: "ghp_secret",
  organizationId: "firma-x",
  authorName: "Anna",
  authorEmail: "anna@firma.se",
};

beforeEach(() => {
  localStorage.clear();
});

describe("FirmaSettingsPanel — auth-relaterad UI", () => {
  it("default-toggle = allowAnonymousRead true", () => {
    render(<FirmaSettingsPanel initial={baseConfig} onSaved={() => {}} onCancel={() => {}} />);
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("läser pre-existerande allowAnonymousRead=false från localStorage", () => {
    saveAuthSettings({ allowAnonymousRead: false });
    render(<FirmaSettingsPanel initial={baseConfig} onSaved={() => {}} onCancel={() => {}} />);
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("spara-knapp persisterar allowAnonymousRead", () => {
    const onSaved = vi.fn();
    render(<FirmaSettingsPanel initial={baseConfig} onSaved={onSaved} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Spara & ladda om"));
    expect(loadAuthSettings()).toEqual({ allowAnonymousRead: false });
    expect(onSaved).toHaveBeenCalled();
  });

  it("logga-ut-knappen visas bara när token finns", () => {
    const { unmount } = render(
      <FirmaSettingsPanel initial={baseConfig} onSaved={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByText(/Logga ut/)).toBeTruthy();
    unmount();
    render(
      <FirmaSettingsPanel initial={{ ...baseConfig, token: "" }} onSaved={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByText(/Logga ut/)).toBeNull();
  });

  it("logga-ut rensar token och triggar onSaved", () => {
    const onSaved = vi.fn();
    render(<FirmaSettingsPanel initial={baseConfig} onSaved={onSaved} onCancel={() => {}} />);
    fireEvent.click(screen.getByText(/Logga ut/));
    expect(onSaved).toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem("ava.firma") ?? "{}");
    expect(stored.token).toBe("");
  });
});
