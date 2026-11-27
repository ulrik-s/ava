/**
 * Den riktiga MSAL-fabriken i registry-connectorn (#1950): MSAL ska få
 * `redirectUri` = `<origin><basePath>/msal-redirect/`, så att popupen och den
 * tysta förnyelsen landar på bridge-sidan som MSAL v5 kräver.
 *
 * `@azure/msal-browser` mockas, så fabrikens dynamiska import får en
 * `PublicClientApplication` som sparar sin konfiguration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { OFFICE365_CONFIG_KEY } from "@/lib/client/integrations/office365-config";
import type { IntegrationConnector } from "@/lib/client/integrations/types";

interface CapturedConfig {
  readonly auth: { readonly clientId: string; readonly authority: string; readonly redirectUri: string };
  readonly cache: { readonly cacheLocation: string };
}

const configs: CapturedConfig[] = [];
const account = { homeAccountId: "h", username: "a@example.com", name: "A" };

class FakePublicClientApplication {
  constructor(config: CapturedConfig) {
    configs.push(config);
  }
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  acquireTokenPopup(): Promise<{ accessToken: string; account: typeof account }> {
    return Promise.resolve({ accessToken: "t", account });
  }
  getAllAccounts(): (typeof account)[] {
    return [account];
  }
  logoutPopup(): Promise<void> {
    return Promise.resolve();
  }
}

vi.mock("@azure/msal-browser", () => ({ PublicClientApplication: FakePublicClientApplication }));

async function office365(): Promise<IntegrationConnector> {
  await import("@/lib/client/integrations/office365-connector");
  const { getConnector } = await import("@/lib/client/integrations/registry");
  const c = getConnector("office365");
  if (!c) throw new Error("office365-connector ej registrerad");
  return c;
}

const originalBasePath = process.env.NEXT_PUBLIC_DEMO_BASE_PATH;

beforeEach(async () => {
  configs.length = 0;
  localStorage.setItem(OFFICE365_CONFIG_KEY, JSON.stringify({ clientId: "c", tenantId: "t" }));
  await (await office365()).disconnect();
});

afterEach(() => {
  localStorage.removeItem(OFFICE365_CONFIG_KEY);
  if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_DEMO_BASE_PATH;
  else process.env.NEXT_PUBLIC_DEMO_BASE_PATH = originalBasePath;
});

describe("Office365Connector: MSAL-fabrikens konfiguration (#1950)", () => {
  it("redirectUri pekar på /msal-redirect/ utan basePath", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_BASE_PATH;
    await (await office365()).connect();
    expect(configs).toHaveLength(1);
    expect(configs[0]?.auth.redirectUri).toBe(`${window.location.origin}/msal-redirect/`);
  });

  it("redirectUri pekar på <basePath>/msal-redirect/ med basePath", async () => {
    process.env.NEXT_PUBLIC_DEMO_BASE_PATH = "/ava";
    await (await office365()).connect();
    expect(configs[0]?.auth.redirectUri).toBe(`${window.location.origin}/ava/msal-redirect/`);
  });

  it("clientId, authority och sessionStorage-cachen följer med", async () => {
    await (await office365()).connect();
    expect(configs[0]?.auth.clientId).toBe("c");
    expect(configs[0]?.auth.authority).toBe("https://login.microsoftonline.com/t");
    expect(configs[0]?.cache.cacheLocation).toBe("sessionStorage");
  });
});
