/**
 * `passkey-ceremony` — orkestrerar WebAuthn-flödet (register +
 * authenticate) via @simplewebauthn/server, men utan kunskap om
 * Prisma eller Next-routes.
 *
 * Designval (SOLID):
 *   - **Single responsibility:** varje funktion gör EN ceremony-fas.
 *   - **Open-closed:** `IPasskeyStore` är expansionspunkten —
 *     produktion mot Prisma, tester mot in-memory.
 *   - **Liskov:** alla store-impl uppfyller samma kontrakt.
 *   - **Interface segregation:** smal yta — 6 metoder.
 *   - **Dependency inversion:** caller injicerar config + store.
 *
 * Hela komplexiteten av FIDO2-CBOR/COSE/EC-signaturer ligger i
 * `@simplewebauthn/server`. Vi limmar bara.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type GenerateAuthenticationOptionsOpts,
  type VerifyAuthenticationResponseOpts,
} from "@simplewebauthn/server";

// ─── Public types ───────────────────────────────────────────────

export interface PasskeyConfig {
  /** Display-namn för Relying Party (visas i passkey-prompten). */
  rpName: string;
  /** RP-id (domain). Produktion: "ava.example". Lokalt: "localhost". */
  rpId: string;
  /** Förväntad origin för auth-responses. */
  origin: string;
}

export interface StoredPasskey {
  id: string; // base64url credential-id
  userId: string;
  publicKey: string; // base64url
  counter: bigint;
  transports: string[];
  name?: string | null;
  backedUp: boolean;
  deviceType: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
}

export interface IPasskeyStore {
  saveChallenge(handle: string, challenge: string): Promise<void>;
  readChallenge(handle: string): Promise<string | null>;
  clearChallenge(handle: string): Promise<void>;
  savePasskey(p: StoredPasskey): Promise<void>;
  findPasskeyById(id: string): Promise<StoredPasskey | null>;
  listPasskeysForUser(userId: string): Promise<StoredPasskey[]>;
  updateCounter(id: string, counter: bigint): Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────

type AuthenticatorTransportFuture =
  | "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

function asTransports(arr: string[]): AuthenticatorTransportFuture[] {
  const valid = new Set<string>(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);
  return arr.filter((t) => valid.has(t)) as AuthenticatorTransportFuture[];
}

// ─── Registration ───────────────────────────────────────────────

export interface BeginRegistrationInput {
  config: PasskeyConfig;
  store: IPasskeyStore;
  user: { id: string; email: string; name: string };
}

export async function beginRegistration(input: BeginRegistrationInput) {
  const existing = await input.store.listPasskeysForUser(input.user.id);
  const opts: GenerateRegistrationOptionsOpts = {
    rpName: input.config.rpName,
    rpID: input.config.rpId,
    userName: input.user.email,
    userDisplayName: input.user.name,
    userID: new TextEncoder().encode(input.user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.id,
      transports: asTransports(p.transports),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  };
  const options = await generateRegistrationOptions(opts);
  await input.store.saveChallenge(input.user.id, options.challenge);
  return { options };
}

export interface FinishRegistrationInput {
  config: PasskeyConfig;
  store: IPasskeyStore;
  userId: string;
  response: VerifyRegistrationResponseOpts["response"];
  /** Användar-vänligt namn för passkey:n (t.ex. enhetens namn). */
  name?: string;
}

export async function finishRegistration(input: FinishRegistrationInput): Promise<{ ok: boolean; passkeyId?: string }> {
  const expectedChallenge = await input.store.readChallenge(input.userId);
  if (!expectedChallenge) {
    throw new Error("Ingen challenge sparad för användaren — beginRegistration kallades aldrig");
  }
  try {
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: input.config.origin,
      expectedRPID: input.config.rpId,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return { ok: false };
    }
    const reg = verification.registrationInfo;
    const cred = reg.credential;
    await input.store.savePasskey({
      id: cred.id,
      userId: input.userId,
      publicKey: Buffer.from(cred.publicKey).toString("base64url"),
      counter: BigInt(cred.counter),
      transports: cred.transports ?? [],
      name: input.name ?? null,
      backedUp: reg.credentialBackedUp,
      deviceType: reg.credentialDeviceType,
      createdAt: new Date(),
    });
    return { ok: true, passkeyId: cred.id };
  } finally {
    await input.store.clearChallenge(input.userId);
  }
}

// ─── Authentication ─────────────────────────────────────────────

export interface BeginAuthenticationInput {
  config: PasskeyConfig;
  store: IPasskeyStore;
  /** Opak session-id (cookie-värde) — vi sparar challenge under denna. */
  handle: string;
  /** Om satt: begränsa passkeys till denna användares. Annars: usernameless. */
  userId?: string;
}

export async function beginAuthentication(input: BeginAuthenticationInput) {
  const allowCredentials = input.userId
    ? (await input.store.listPasskeysForUser(input.userId)).map((p) => ({
        id: p.id,
        transports: asTransports(p.transports),
      }))
    : [];
  const opts: GenerateAuthenticationOptionsOpts = {
    rpID: input.config.rpId,
    allowCredentials,
    userVerification: "preferred",
  };
  const options = await generateAuthenticationOptions(opts);
  await input.store.saveChallenge(input.handle, options.challenge);
  return { options };
}

export interface FinishAuthenticationInput {
  config: PasskeyConfig;
  store: IPasskeyStore;
  handle: string;
  response: VerifyAuthenticationResponseOpts["response"];
}

export interface AuthenticationResult {
  ok: boolean;
  userId?: string;
  passkeyId?: string;
}

export async function finishAuthentication(input: FinishAuthenticationInput): Promise<AuthenticationResult> {
  const expectedChallenge = await input.store.readChallenge(input.handle);
  if (!expectedChallenge) {
    throw new Error("Ingen challenge sparad för denna session — beginAuthentication kallades aldrig");
  }
  try {
    const passkey = await input.store.findPasskeyById(input.response.id);
    if (!passkey) {
      throw new Error(`Ingen passkey/credential registrerad med id "${input.response.id}"`);
    }
    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: input.config.origin,
      expectedRPID: input.config.rpId,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
        counter: Number(passkey.counter),
        transports: asTransports(passkey.transports),
      },
    });
    if (!verification.verified) return { ok: false };
    await input.store.updateCounter(passkey.id, BigInt(verification.authenticationInfo.newCounter));
    return { ok: true, userId: passkey.userId, passkeyId: passkey.id };
  } finally {
    await input.store.clearChallenge(input.handle);
  }
}
