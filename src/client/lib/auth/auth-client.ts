"use client";

/**
 * `auth-client` — tunn fetch-wrapper mot `/auth/`-endpoints i självhostat läge.
 *
 * Pure: ingen state, ingen localStorage. Caller äger var token sparas.
 * `baseUrl` injicerbar för test (default = same-origin `/auth`).
 */

export interface AuthStatus {
  hasAdmin: boolean;
  totalUsers: number;
}

export interface ProvisionedAccount {
  email: string;
  token: string;
  role: "ADMIN" | "LAWYER" | "ASSISTANT";
}

export interface AuthClient {
  status(): Promise<AuthStatus>;
  bootstrap(args: { secret: string; email: string }): Promise<ProvisionedAccount>;
  redeemInvite(args: { inviteToken: string; email: string }): Promise<ProvisionedAccount>;
  invite(args: { adminEmail: string; adminToken: string; email: string; role: string }): Promise<{ inviteToken: string; expiresAt: string }>;
}

export interface AuthClientOpts {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

class AuthClientImpl implements AuthClient {
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(opts: AuthClientOpts) {
    this.base = (opts.baseUrl ?? "/auth").replace(/\/+$/, "");
    this.fetch = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(this.base + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  status() { return this.req<AuthStatus>("/status"); }
  bootstrap(args: { secret: string; email: string }) {
    return this.req<ProvisionedAccount>("/bootstrap", { method: "POST", body: JSON.stringify(args) });
  }
  redeemInvite(args: { inviteToken: string; email: string }) {
    return this.req<ProvisionedAccount>("/redeem-invite", { method: "POST", body: JSON.stringify(args) });
  }
  invite(args: { adminEmail: string; adminToken: string; email: string; role: string }) {
    return this.req<{ inviteToken: string; expiresAt: string }>("/invite", { method: "POST", body: JSON.stringify(args) });
  }
}

export function createAuthClient(opts: AuthClientOpts = {}): AuthClient {
  return new AuthClientImpl(opts);
}
