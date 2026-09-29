/**
 * `HelperAutoConfig` (ADR 0029, #1161) — web-appen pushar SERVERNS
 * inloggnings-config till helpern.
 *
 * Två buggar från piloten mot ava-crm.io (helpern loggade in mot en gammal
 * server, "fetch failed"):
 *   1. Configen lästes via klientens in-process-tRPC — i self-hosted körs
 *      `system.helperConfig` då i WEBBLÄSAREN, där serverns env saknas → alltid
 *      null → ingen push, någonsin. Nu hämtas den från servern (`loadConfig`).
 *   2. Pushen markerades som gjord INNAN den skickades; misslyckades den (t.ex.
 *      medan helpern väntade på "Tillåt") försökte fliken aldrig igen. Nu: klart
 *      först när helpern TAGIT EMOT configen, annars nytt försök.
 */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { HelperConfigRequest } from "@/lib/shared/helper/protocol";

const CFG: HelperConfigRequest = { oidcIssuer: "https://login.microsoftonline.com/t/v2.0", oidcClientId: "ava-helper", oidcScope: "api://x/access_as_user" };
const configureHelper = vi.fn(async (_cfg: unknown): Promise<boolean> => true);
let present = true;

vi.mock("@/lib/client/helper/use-helper", () => ({
  useHelper: () => ({ version: present ? "0.2.0" : null }),
  configureHelper: (cfg: unknown) => configureHelper(cfg),
}));

const { HelperAutoConfig } = await import("@/components/shell/helper-auto-config");
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  configureHelper.mockReset();
  present = true;
});

describe("HelperAutoConfig", () => {
  it("hämtar configen från servern och pushar den en gång när helpern finns", async () => {
    configureHelper.mockResolvedValue(true);
    const loadConfig = vi.fn(async () => CFG);
    render(<HelperAutoConfig loadConfig={loadConfig} retryMs={5} />);
    await waitFor(() => expect(configureHelper).toHaveBeenCalledTimes(1));
    expect(configureHelper).toHaveBeenCalledWith(CFG);
    await tick(30);
    expect(configureHelper).toHaveBeenCalledTimes(1);
  });

  it("en misslyckad push (t.ex. i väntan på 'Tillåt') försöks igen tills helpern tar emot den", async () => {
    configureHelper.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<HelperAutoConfig loadConfig={async () => CFG} retryMs={5} />);
    await waitFor(() => expect(configureHelper).toHaveBeenCalledTimes(3));
    await tick(30);
    expect(configureHelper).toHaveBeenCalledTimes(3);
  });

  it("servern går inte att nå (hämtningen kastar) → nytt försök, sedan push", async () => {
    configureHelper.mockResolvedValue(true);
    const loadConfig = vi.fn(async (): Promise<HelperConfigRequest | null> => CFG).mockRejectedValueOnce(new Error("nätfel"));
    render(<HelperAutoConfig loadConfig={loadConfig} retryMs={5} />);
    await waitFor(() => expect(configureHelper).toHaveBeenCalledTimes(1));
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  it("ingen helper → varken hämtning eller push", async () => {
    present = false;
    const loadConfig = vi.fn(async () => CFG);
    render(<HelperAutoConfig loadConfig={loadConfig} retryMs={5} />);
    await tick(20);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(configureHelper).not.toHaveBeenCalled();
  });

  it("servern saknar helper-inloggning (null) → ingen push och inga nya försök", async () => {
    const loadConfig = vi.fn(async () => null);
    render(<HelperAutoConfig loadConfig={loadConfig} retryMs={5} />);
    await tick(30);
    expect(configureHelper).not.toHaveBeenCalled();
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it("avmonterad medan configen hämtas → ingen push", async () => {
    let release: (cfg: HelperConfigRequest) => void = () => {};
    const loadConfig = () => new Promise<HelperConfigRequest>((r) => { release = r; });
    const { unmount } = render(<HelperAutoConfig loadConfig={loadConfig} retryMs={5} />);
    await tick(10);
    unmount();
    release(CFG);
    await tick(20);
    expect(configureHelper).not.toHaveBeenCalled();
  });

  it("avmonterad under ett väntande nytt försök → inga fler försök", async () => {
    configureHelper.mockResolvedValue(false);
    const { unmount } = render(<HelperAutoConfig loadConfig={async () => CFG} retryMs={50} />);
    await waitFor(() => expect(configureHelper).toHaveBeenCalled());
    unmount();
    const atUnmount = configureHelper.mock.calls.length;
    await tick(200);
    expect(configureHelper).toHaveBeenCalledTimes(atUnmount);
  });
});
