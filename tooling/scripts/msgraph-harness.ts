/**
 * Gemensam uppsättning för Graph-skripten (#1073).
 *
 * Speglar `fortnox-harness.ts`: samma env-läsning, samma "starta med utgången
 * access-token så att FÖRSTA anropet tvingas refresha", samma write-back av
 * den roterade token:en.
 *
 * Env (se docs/ms-graph.md):
 *   AVA_MS_CLIENT_ID / _CLIENT_SECRET / _TENANT_ID / _REFRESH_TOKEN  obligatoriska
 *   AVA_MS_TEST_MAILBOX   brevlådan e2e:t skickar till och läser ur
 *   AVA_MS_REDIRECT_URI   bara för schemat; token-bytet använder den inte
 */

import { refreshTokens } from "@/lib/server/integrations/msgraph/oauth";
import {
  msGraphConfigSchema, MS_DEFAULT_SCOPES, MS_GRAPH_BASE,
  type MsGraphConfig,
} from "@/lib/server/integrations/msgraph/schema";
import { InMemoryGraphTokenStore } from "@/lib/server/integrations/msgraph/token-store";

/** Obligatorisk env — avbryter med exit 2 och en läsbar hänvisning. */
export function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} saknas. Se docs/ms-graph.md för vilka secrets som krävs.`);
    process.exit(2);
  }
  return v;
}

export function buildConfig(): MsGraphConfig {
  return msGraphConfigSchema.parse({
    clientId: required("AVA_MS_CLIENT_ID"),
    clientSecret: required("AVA_MS_CLIENT_SECRET"),
    tenantId: required("AVA_MS_TENANT_ID"),
    // Token-endpointen bryr sig inte om redirect_uri vid refresh_token-grant,
    // men schemat kräver en giltig URL. Loopbacken är den registrerade.
    redirectUri: process.env.AVA_MS_REDIRECT_URI ?? "http://localhost:53682/callback",
    scopes: [...MS_DEFAULT_SCOPES],
  });
}

/**
 * En minimal Graph-klient. Inte en generell SDK — bara det e2e:t behöver, med
 * `Authorization` och bas-URL på ETT ställe så att ingen anropsplats kan glömma
 * dem.
 */
export class GraphSmokeClient {
  constructor(
    private readonly accessToken: string,
    private readonly base: string = MS_GRAPH_BASE,
  ) {}

  /** GET som JSON. Kastar med Graphs egen felkropp — den säger vad som var fel. */
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}/v1.0${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Graph GET ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
}

/**
 * Refresha OMEDELBART och returnera klient + store.
 *
 * Refreshen görs här, inte lat vid första anropet, av ett skäl som kostade
 * Fortnox en körning: den roterade token:en måste kunna skrivas tillbaka även
 * om resten av körningen faller. Anroparen ska kunna göra
 * `emitRotatedToken(store)` som allra första sak efter det här.
 */
export async function connectGraph(
  config: MsGraphConfig = buildConfig(),
): Promise<{ client: GraphSmokeClient; store: InMemoryGraphTokenStore }> {
  const store = new InMemoryGraphTokenStore();
  const tokens = await refreshTokens(config, required("AVA_MS_REFRESH_TOKEN"));
  await store.save(tokens);
  return { client: new GraphSmokeClient(tokens.accessToken), store };
}
