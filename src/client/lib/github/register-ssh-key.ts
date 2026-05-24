"use client";

/**
 * Registrera en SSH-publik nyckel hos GitHub via `POST /user/keys`.
 * api.github.com har CORS-stöd så det här kan göras direkt från
 * browser:n, utan worker-proxy.
 *
 * Token måste ha scope `admin:public_key` (eller `write:public_key`).
 * Existerande PAT med `repo`-scope räcker INTE — användaren måste
 * skapa en separat token med rätt scope, eller utöka existerande.
 */

export interface RegisterArgs {
  token: string;
  title: string;
  /** SSH-publika nyckeln i OpenSSH-format ("ssh-ed25519 AAAA…"). */
  key: string;
}

export interface RegisteredKey {
  id: number;
  key: string;
  title: string;
  created_at: string;
  verified: boolean;
}

export async function registerSshKeyOnGithub(args: RegisterArgs): Promise<RegisteredKey> {
  const res = await fetch("https://api.github.com/user/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: args.title, key: args.key }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string; errors?: Array<{ message: string }> };
    const detail = err.errors?.[0]?.message ?? err.message ?? res.statusText;
    if (res.status === 401) throw new Error("GitHub avvisade token (401). Den behöver scope 'admin:public_key' eller 'write:public_key'.");
    if (res.status === 422) throw new Error(`GitHub kunde inte spara nyckeln (422): ${detail}`);
    throw new Error(`GitHub ${res.status}: ${detail}`);
  }
  return res.json();
}
