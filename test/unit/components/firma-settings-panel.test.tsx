/**
 * Tester för `FirmaSettingsPanel` + extraherade sub-komponenter + pure helpers.
 *
 * Strategi:
 *   - Pure helpers (validateGithubToken, testOAuthProxy, testCorsProxy) testas
 *     direkt utan render — billigast och mest robust.
 *   - Sub-komponenter (TierPicker, RepoField, IdentityFields, FooterButtons,
 *     ProxyTestButton, CorsProxyField, AuthTokenSection) testas isolerat via RTL.
 *   - Main FirmaSettingsPanel — happy paths för save/cancel/demo/logout.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AuthTokenSection,
  CorsProxyField,
  FirmaSettingsPanel,
  FooterButtons,
  IdentityFields,
  ProxyTestButton,
  RepoField,
  TierPicker,
  testCorsProxy,
  testOAuthProxy,
  validateGithubToken,
} from "@/client/components/firma-settings-panel";
import { loadAuthSettings, saveAuthSettings } from "@/client/lib/auth/use-auth-mode";
import type { FirmaConfig } from "@/client/lib/firma/firma-config";

// Mocka WebOAuthDeviceFlow så den inte gör nätverksanrop i renderingar
vi.mock("@/client/components/web-oauth-device-flow", () => ({
  WebOAuthDeviceFlow: ({ onCancel }: { onComplete: (t: string) => void; onCancel: () => void }) => (
    <div data-testid="oauth-device-flow">
      <button onClick={onCancel}>Avbryt OAuth</button>
    </div>
  ),
}));

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

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

// ─── Pure helpers ─────────────────────────────────────────────────────────

describe("validateGithubToken", () => {
  it("returnerar 'Tom token' när token saknas", async () => {
    expect(await validateGithubToken({ token: "", tier: "github", repo: "" }))
      .toEqual({ status: "invalid", msg: "Tom token" });
  });

  it("returnerar invalid vid 401 från /user", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 401, statusText: "Unauthorized",
    } as Response));
    const r = await validateGithubToken({ token: "bad", tier: "github", repo: "", fetchFn });
    expect(r).toEqual({ status: "invalid", msg: "GitHub avvisade: 401 Unauthorized" });
  });

  it("returnerar valid + login utan repo-check när repo saknas", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ login: "anna" }),
    } as Response));
    const r = await validateGithubToken({ token: "t", tier: "github", repo: "", fetchFn });
    expect(r).toEqual({ status: "valid", msg: "✓ @anna" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("hoppar repo-check när tier är self-hosted", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, json: async () => ({ login: "anna" }),
    } as Response));
    const r = await validateGithubToken({ token: "t", tier: "self-hosted", repo: "x/y", fetchFn });
    expect(r.status).toBe("valid");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("kontrollerar repo-åtkomst och rapporterar push-permission", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ login: "anna" }) } as Response;
      return { ok: true, json: async () => ({ permissions: { push: true } }) } as Response;
    });
    const r = await validateGithubToken({ token: "t", tier: "github", repo: "anna/proj", fetchFn });
    expect(r).toEqual({ status: "valid", msg: "✓ @anna — kan pusha" });
  });

  it("rapporterar 'endast läsning' när push saknas", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ login: "anna" }) } as Response;
      return { ok: true, json: async () => ({ permissions: { push: false } }) } as Response;
    });
    const r = await validateGithubToken({ token: "t", tier: "github", repo: "anna/proj", fetchFn });
    expect(r.msg).toContain("endast läsning");
  });

  it("returnerar invalid när repo-fetch 404:ar", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ login: "anna" }) } as Response;
      return { ok: false, status: 404 } as Response;
    });
    const r = await validateGithubToken({ token: "t", tier: "github", repo: "anna/proj", fetchFn });
    expect(r.status).toBe("invalid");
    expect(r.msg).toContain("Ingen åtkomst");
  });

  it("matchar inte ogiltig repo-format → faller tillbaka till valid + login", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, json: async () => ({ login: "anna" }),
    } as Response));
    const r = await validateGithubToken({ token: "t", tier: "github", repo: "not-a-repo", fetchFn });
    expect(r.msg).toBe("✓ @anna");
  });
});

describe("testOAuthProxy", () => {
  it("returnerar 'Saknar URL' när tom", async () => {
    expect(await testOAuthProxy("")).toEqual({ ok: false, msg: "Saknar URL" });
  });

  it("returnerar ok med user_code i success-meddelande + strippar trailing slash", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, json: async () => ({ user_code: "ABCD-1234" }),
    } as Response));
    const r = await testOAuthProxy("https://proxy.local/", fetchFn);
    expect(r.ok).toBe(true);
    expect(r.msg).toContain("ABCD-1234");
    expect(String((fetchFn.mock.calls as unknown as unknown[][])[0][0])).toBe("https://proxy.local/device/code");
  });

  it("returnerar ok=false vid 500", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 500, statusText: "Server Error",
    } as Response));
    expect((await testOAuthProxy("https://x", fetchFn)).msg).toContain("500");
  });

  it("hanterar oväntat svar (saknar user_code)", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, json: async () => ({ error: "bad_request" }),
    } as Response));
    const r = await testOAuthProxy("https://x", fetchFn);
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("bad_request");
  });

  it("hanterar fetch som kastar", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("net down"); });
    expect((await testOAuthProxy("https://x", fetchFn)).msg).toContain("net down");
  });
});

describe("testCorsProxy", () => {
  it("använder default-proxy när value är tom", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 } as Response));
    await testCorsProxy("", fetchFn);
    expect(String((fetchFn.mock.calls as unknown as unknown[][])[0][0])).toContain("cors.isomorphic-git.org");
  });

  it("returnerar ok när proxy svarar 200", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 } as Response));
    expect((await testCorsProxy("https://my-proxy", fetchFn)).ok).toBe(true);
  });

  it("hanterar fetch-throw med felmeddelande", async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const r = await testCorsProxy("https://x", fetchFn);
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("Failed to fetch");
  });

  it("strippar trailing slashes innan path-konkatenering", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true } as Response));
    await testCorsProxy("https://proxy/", fetchFn);
    expect(String((fetchFn.mock.calls as unknown as unknown[][])[0][0])).not.toMatch(/proxy\/\/github/);
  });
});

// ─── Sub-components ───────────────────────────────────────────────────────

describe("TierPicker", () => {
  it("renderar tre tier-knappar", () => {
    render(<TierPicker value="demo" onChange={() => {}} />);
    expect(screen.getByText("1. Demo (publik)")).toBeInTheDocument();
    expect(screen.getByText("2. GitHub (privat)")).toBeInTheDocument();
    expect(screen.getByText("3. Self-hosted (Cleura/Linux)")).toBeInTheDocument();
  });

  it("markerar aktiv tier med blå bakgrund", () => {
    const { rerender } = render(<TierPicker value="demo" onChange={() => {}} />);
    expect(screen.getByText("1. Demo (publik)").className).toContain("bg-blue-600");
    rerender(<TierPicker value="github" onChange={() => {}} />);
    expect(screen.getByText("2. GitHub (privat)").className).toContain("bg-blue-600");
    expect(screen.getByText("1. Demo (publik)").className).not.toContain("bg-blue-600");
  });

  it("anropar onChange med vald tier", () => {
    const onChange = vi.fn();
    render(<TierPicker value="demo" onChange={onChange} />);
    fireEvent.click(screen.getByText("3. Self-hosted (Cleura/Linux)"));
    expect(onChange).toHaveBeenCalledWith("self-hosted");
  });
});

describe("RepoField", () => {
  it("renderar input med tier-specifik placeholder", () => {
    const { rerender } = render(<RepoField tier="github" value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText(/user\/repo eller https/)).toBeInTheDocument();
    rerender(<RepoField tier="self-hosted" value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText(/git\.firma\.se/)).toBeInTheDocument();
  });

  it("propagerar input till onChange", () => {
    const onChange = vi.fn();
    render(<RepoField tier="github" value="" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/user\/repo/), { target: { value: "x/y" } });
    expect(onChange).toHaveBeenCalledWith("x/y");
  });
});

describe("IdentityFields", () => {
  it("renderar name + email med värden", () => {
    render(<IdentityFields name="Anna" email="anna@firma.se" onNameChange={() => {}} onEmailChange={() => {}} />);
    expect((screen.getByPlaceholderText("Anna Advokat") as HTMLInputElement).value).toBe("Anna");
    expect((screen.getByPlaceholderText("anna@firma.se") as HTMLInputElement).value).toBe("anna@firma.se");
  });

  it("propagerar ändringar", () => {
    const onNameChange = vi.fn();
    const onEmailChange = vi.fn();
    render(<IdentityFields name="" email="" onNameChange={onNameChange} onEmailChange={onEmailChange} />);
    fireEvent.change(screen.getByPlaceholderText("Anna Advokat"), { target: { value: "Bob" } });
    fireEvent.change(screen.getByPlaceholderText("anna@firma.se"), { target: { value: "b@x" } });
    expect(onNameChange).toHaveBeenCalledWith("Bob");
    expect(onEmailChange).toHaveBeenCalledWith("b@x");
  });
});

describe("FooterButtons", () => {
  function setup(overrides: Partial<Parameters<typeof FooterButtons>[0]> = {}) {
    const props = {
      inline: false, canSave: true, hasToken: false,
      onSave: vi.fn(), onCancel: vi.fn(), onLogOut: vi.fn(), onUseDemo: vi.fn(),
      ...overrides,
    };
    render(<FooterButtons {...props} />);
    return props;
  }

  it("visar Avbryt + Spara i modal-mode", () => {
    setup();
    expect(screen.getByText("Avbryt")).toBeInTheDocument();
    expect(screen.getByText("Spara & ladda om")).toBeInTheDocument();
  });

  it("döljer Avbryt i inline-mode", () => {
    setup({ inline: true });
    expect(screen.queryByText("Avbryt")).toBeNull();
  });

  it("disablar Spara när canSave=false", () => {
    setup({ canSave: false });
    expect((screen.getByText("Spara & ladda om") as HTMLButtonElement).disabled).toBe(true);
  });

  it("anropar alla callbacks", () => {
    const p = setup({ hasToken: true });
    fireEvent.click(screen.getByText("Återställ till demo"));
    fireEvent.click(screen.getByText(/Logga ut/));
    fireEvent.click(screen.getByText("Avbryt"));
    fireEvent.click(screen.getByText("Spara & ladda om"));
    expect(p.onUseDemo).toHaveBeenCalled();
    expect(p.onLogOut).toHaveBeenCalled();
    expect(p.onCancel).toHaveBeenCalled();
    expect(p.onSave).toHaveBeenCalled();
  });
});

describe("ProxyTestButton", () => {
  it("är disablad utan URL", () => {
    render(<ProxyTestButton url="" />);
    expect((screen.getByText("Testa proxy-anslutning") as HTMLButtonElement).disabled).toBe(true);
  });

  it("kör testet och visar ✓ vid success", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ user_code: "AAAA" }),
    } as Response)) as typeof fetch;
    render(<ProxyTestButton url="https://proxy.local" />);
    fireEvent.click(screen.getByText("Testa proxy-anslutning"));
    await waitFor(() => expect(screen.getByText(/Proxy svarar.*AAAA/)).toBeInTheDocument());
  });
});

describe("CorsProxyField", () => {
  it("renderar med prefab-knappar", () => {
    render(<CorsProxyField value="" onChange={() => {}} />);
    expect(screen.getByText(/cors\.isomorphic-git\.org \(default\)/)).toBeInTheDocument();
    expect(screen.getByText(/cors\.proxy\.aulneau\.com/)).toBeInTheDocument();
  });

  it("klick på prefab-knapp byter värde", () => {
    const onChange = vi.fn();
    render(<CorsProxyField value="" onChange={onChange} />);
    fireEvent.click(screen.getByText(/cors\.proxy\.aulneau\.com/));
    expect(onChange).toHaveBeenCalledWith("https://cors.proxy.aulneau.com");
  });

  it("test-knappen visar success-meddelande", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 } as Response)) as typeof fetch;
    render(<CorsProxyField value="https://x" onChange={() => {}} />);
    fireEvent.click(screen.getByText("Testa"));
    await waitFor(() => expect(screen.getByText(/Proxy svarar \(200\)/)).toBeInTheDocument());
  });
});

describe("AuthTokenSection", () => {
  it("visar inte Verifiera-knappen för self-hosted", () => {
    render(<AuthTokenSection
      tier="self-hosted" token="t" onTokenChange={() => {}}
      oauth={{ proxyUrl: "", clientId: "" }} onOauthChange={() => {}} orgId="o"
    />);
    expect(screen.queryByText("Verifiera")).toBeNull();
  });

  it("visar Verifiera + PAT-länk för github-tier", () => {
    render(<AuthTokenSection
      tier="github" token="t" onTokenChange={() => {}}
      oauth={{ proxyUrl: "", clientId: "" }} onOauthChange={() => {}} orgId="o"
    />);
    expect(screen.getByText("Verifiera")).toBeInTheDocument();
    expect(screen.getByText(/Skapa PAT på GitHub/)).toBeInTheDocument();
  });

  it("toggle OAuth-config visar input-fält", () => {
    render(<AuthTokenSection
      tier="github" token="" onTokenChange={() => {}}
      oauth={{ proxyUrl: "", clientId: "" }} onOauthChange={() => {}} orgId="o"
    />);
    fireEvent.click(screen.getByText("OAuth-config"));
    expect(screen.getByPlaceholderText(/ava-oauth-proxy/)).toBeInTheDocument();
  });
});
