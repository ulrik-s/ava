/**
 * Fortnox-anslutningen i server-runtime:n (#1172) — det som gör connectorn
 * (`connector.ts`) nåbar från appen i stället för bara från test-skripten.
 *
 * - **OAuth per byrå**: administratören skickas till Fortnox från
 *   Inställningar; callback-sidan växlar in `code` här. `state` delas ut och
 *   kontrolleras i minnet (CSRF) — en omstart mitt i en anslutning betyder
 *   bara att man klickar "Anslut" igen.
 * - **Tokens i valvet** (#79, ADR 0008) under `fortnox.tokens.<orgId>`.
 *   Refresh-token:en roterar vid varje användning och måste överleva omstart.
 * - **Serialiserat**: två samtidiga refreshar med samma refresh-token dödar
 *   anslutningen (den andra använder en redan ogiltigförklarad token).
 */

import { randomBytes } from "node:crypto";
import type { LedgerAccountMap } from "@/lib/shared/accounting/account-map";
import type { ILedgerService, LedgerStatus } from "../../ports";
import { createVaultFromEnv, type SecretsVault } from "../../secrets/vault";
import type { LedgerConnector } from "../ledger/port";
import { FortnoxClient } from "./client";
import { FortnoxLedgerConnector } from "./connector";
import { buildAuthorizeUrl, exchangeCodeForTokens, type FetchFn } from "./oauth";
import { fortnoxConfigSchema, fortnoxMappingFromLedgerMap, type FortnoxConfig } from "./schema";
import { VaultFortnoxTokenStore } from "./token-store";

/** Hur länge en utdelad `state` gäller — en consent-runda tar sekunder, inte timmar. */
const STATE_TTL_MS = 10 * 60_000;

export class FortnoxLedgerService implements ILedgerService {
  private readonly states = new Map<string, { orgId: string; expiresAt: number }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly config: FortnoxConfig,
    private readonly vault: SecretsVault,
    private readonly fetchFn: FetchFn = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private store(orgId: string): VaultFortnoxTokenStore {
    return new VaultFortnoxTokenStore(this.vault, `fortnox.tokens.${orgId}`);
  }

  // ponytail: ett globalt lås över alla Fortnox-anrop; per-org-lås om flera byråer delar server.
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async status(orgId: string): Promise<LedgerStatus> {
    return { configured: true, connected: (await this.store(orgId).load()) !== null };
  }

  async authorizeUrl(orgId: string): Promise<string> {
    const state = randomBytes(16).toString("hex");
    this.states.set(state, { orgId, expiresAt: this.now() + STATE_TTL_MS });
    return buildAuthorizeUrl(this.config, state);
  }

  async completeConnect(orgId: string, code: string, state: string): Promise<void> {
    const entry = this.states.get(state);
    this.states.delete(state);
    if (!entry || entry.orgId !== orgId || entry.expiresAt < this.now()) {
      throw new Error("Anslutningen har gått ut eller är ogiltig — börja om från Inställningar.");
    }
    const tokens = await exchangeCodeForTokens(this.config, code, this.fetchFn, this.now());
    await this.serialized(() => this.store(orgId).save(tokens));
  }

  connector(orgId: string, map: LedgerAccountMap): Pick<LedgerConnector, "pushVoucher" | "capabilities"> {
    const mapping = fortnoxMappingFromLedgerMap(map);
    if (!mapping) throw new Error("Kontomappning saknas.");
    const client = new FortnoxClient(this.config, this.store(orgId), this.fetchFn);
    const inner = new FortnoxLedgerConnector({ client, mapping });
    return {
      capabilities: () => inner.capabilities(),
      pushVoucher: (voucher, ctx) => this.serialized(() => inner.pushVoucher(voucher, ctx)),
    };
  }
}

/**
 * Bygg tjänsten ur miljön, eller `null` när Fortnox inte är konfigurerat:
 *   AVA_FORTNOX_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI   appen i Developer Portal
 *   AVA_SECRETS_KEY / AVA_SECRETS_FILE                       valvet för tokens
 *   AVA_FORTNOX_ACCOUNT_TYPE=service                         valfritt (service-konto)
 */
export function fortnoxLedgerFromEnv(
  env: Record<string, string | undefined> = process.env,
): FortnoxLedgerService | null {
  const { AVA_FORTNOX_CLIENT_ID: clientId, AVA_FORTNOX_CLIENT_SECRET: clientSecret, AVA_FORTNOX_REDIRECT_URI: redirectUri } = env;
  if (!clientId || !clientSecret || !redirectUri || !env.AVA_SECRETS_KEY || !env.AVA_SECRETS_FILE) return null;
  const config = fortnoxConfigSchema.parse({
    clientId, clientSecret, redirectUri, scopes: ["bookkeeping"],
    ...(env.AVA_FORTNOX_ACCOUNT_TYPE === "service" ? { accountType: "service" as const } : {}),
  });
  return new FortnoxLedgerService(config, createVaultFromEnv(env));
}
