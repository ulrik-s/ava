/**
 * Tester för `FirmaSettingsPanel` (server-first, #514) + sub-komponenter.
 *
 * Panelen väljer bara läge (demo / self-hosted) + anonym-läsning numera —
 * git-UI:t (repo-URL, PAT, OAuth, CORS-proxy, commit-identitet) togs bort i
 * och med server-first-cutovern (ADR 0016).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import {
  AnonymousReadToggle,
  DemoRepoField,
  FirmaSettingsPanel,
  FooterButtons,
  TierExplainer,
  TierPicker,
} from "@/components/settings/firma-settings-panel";
import { loadAuthSettings, saveAuthSettings } from "@/lib/client/auth/use-auth-mode";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";

const baseConfig: FirmaConfig = {
  tier: "self-hosted",
  repo: "ulrik-s/ava-demo",
  token: "",
  organizationId: "firma-x",
  authorName: "Anna",
  authorEmail: "anna@firma.se",
};

beforeEach(() => {
  localStorage.clear();
});

describe("FirmaSettingsPanel — server-first", () => {
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

  it("spara persisterar allowAnonymousRead + tier och bevarar övriga fält", () => {
    const onSaved = vi.fn();
    render(<FirmaSettingsPanel initial={baseConfig} onSaved={onSaved} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Spara"));
    expect(loadAuthSettings()).toEqual({ allowAnonymousRead: false });
    const stored = loadFirmaConfig();
    expect(stored.tier).toBe("self-hosted");
    // Bevarade fält som inte längre redigeras i UI:t.
    expect(stored.organizationId).toBe("firma-x");
    expect(stored.authorEmail).toBe("anna@firma.se");
    expect(onSaved).toHaveBeenCalled();
  });

  it("self-hosted visar INGEN repo-/token-/cors-/commit-UI", () => {
    render(<FirmaSettingsPanel initial={baseConfig} onSaved={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText(/Demo-repo/)).toBeNull();
    expect(screen.queryByText(/CORS-proxy/)).toBeNull();
    expect(screen.queryByText(/PAT/)).toBeNull();
    expect(screen.queryByText(/för commits/)).toBeNull();
    expect(screen.getByText(/loggar in via OIDC/)).toBeInTheDocument();
  });

  it("demo-läge visar GH-Pages-repo-fältet", () => {
    render(<FirmaSettingsPanel initial={{ ...baseConfig, tier: "demo" }} onSaved={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/Demo-repo/)).toBeInTheDocument();
  });

  it("Återställ till demo rensar config + triggar onSaved", () => {
    localStorage.setItem("ava.firma", JSON.stringify(baseConfig));
    const onSaved = vi.fn();
    render(<FirmaSettingsPanel initial={baseConfig} onSaved={onSaved} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Återställ till demo"));
    expect(localStorage.getItem("ava.firma")).toBeNull();
    expect(onSaved).toHaveBeenCalled();
  });
});

describe("TierPicker", () => {
  it("renderar två tier-knappar (demo + self-hosted)", () => {
    render(<TierPicker value="demo" onChange={() => {}} />);
    expect(screen.getByText("1. Demo (publik)")).toBeInTheDocument();
    expect(screen.getByText("2. Self-hosted (din server)")).toBeInTheDocument();
    expect(screen.queryByText(/GitHub/)).toBeNull();
  });

  it("markerar aktiv tier med blå bakgrund", () => {
    const { rerender } = render(<TierPicker value="demo" onChange={() => {}} />);
    expect(screen.getByText("1. Demo (publik)").className).toContain("bg-blue-600");
    rerender(<TierPicker value="self-hosted" onChange={() => {}} />);
    expect(screen.getByText("2. Self-hosted (din server)").className).toContain("bg-blue-600");
    expect(screen.getByText("1. Demo (publik)").className).not.toContain("bg-blue-600");
  });

  it("anropar onChange med vald tier", () => {
    const onChange = vi.fn();
    render(<TierPicker value="demo" onChange={onChange} />);
    fireEvent.click(screen.getByText("2. Self-hosted (din server)"));
    expect(onChange).toHaveBeenCalledWith("self-hosted");
  });
});

describe("TierExplainer", () => {
  it("demo nämner read-only", () => {
    render(<TierExplainer tier="demo" />);
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
  });

  it("self-hosted nämner OIDC + same-origin", () => {
    render(<TierExplainer tier="self-hosted" />);
    expect(screen.getByText(/OIDC/)).toBeInTheDocument();
    expect(screen.getByText(/same-origin/)).toBeInTheDocument();
  });
});

describe("DemoRepoField", () => {
  it("propagerar input till onChange", () => {
    const onChange = vi.fn();
    render(<DemoRepoField value="" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("ulrik-s/ava-demo"), { target: { value: "x/y" } });
    expect(onChange).toHaveBeenCalledWith("x/y");
  });
});

describe("AnonymousReadToggle", () => {
  it("propagerar toggle", () => {
    const onChange = vi.fn();
    render(<AnonymousReadToggle checked={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("FooterButtons", () => {
  function setup(overrides: Partial<Parameters<typeof FooterButtons>[0]> = {}) {
    const props = {
      inline: false, canSave: true,
      onSave: vi.fn(), onCancel: vi.fn(), onUseDemo: vi.fn(),
      ...overrides,
    };
    render(<FooterButtons {...props} />);
    return props;
  }

  it("visar Avbryt + Spara i modal-mode", () => {
    setup();
    expect(screen.getByText("Avbryt")).toBeInTheDocument();
    expect(screen.getByText("Spara")).toBeInTheDocument();
  });

  it("döljer Avbryt i inline-mode", () => {
    setup({ inline: true });
    expect(screen.queryByText("Avbryt")).toBeNull();
  });

  it("disablar Spara när canSave=false", () => {
    setup({ canSave: false });
    expect((screen.getByText("Spara") as HTMLButtonElement).disabled).toBe(true);
  });

  it("anropar callbacks", () => {
    const p = setup();
    fireEvent.click(screen.getByText("Återställ till demo"));
    fireEvent.click(screen.getByText("Avbryt"));
    fireEvent.click(screen.getByText("Spara"));
    expect(p.onUseDemo).toHaveBeenCalled();
    expect(p.onCancel).toHaveBeenCalled();
    expect(p.onSave).toHaveBeenCalled();
  });
});
