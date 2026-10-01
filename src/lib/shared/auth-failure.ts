/**
 * Varför servern svarade 401 (#1351) — så att klienten kan ge rätt besked.
 *
 * Utan skälet såg "token har gått ut" och "kontot är spärrat" likadana ut, och
 * klienten gissade: proxyns session levde (userinfo svarade) men servern vägrade
 * → "Ditt konto är inte längre aktivt". Det var fel varje gång ID-token gått ut
 * (efter en timme hos Entra) medan proxyns cookie fortfarande gällde.
 *
 *   - `no-identity`      — ingen token/identitet alls, eller en ogiltig.
 *   - `token-expired`    — en korrekt signerad token som har gått ut.
 *   - `account-inactive` — en giltig identitet som inte (längre) är aktiv i
 *     byråns användarlista.
 *
 * Skälet följer med som `data.authFailure` i tRPC-felet (`trpc-core.ts`).
 * Delas av klient och server.
 */

import { z } from "zod";

/** Skälen servern kan ange. */
export const authFailureSchema = z.enum(["no-identity", "token-expired", "account-inactive"]);

/** Varför servern inte godtog anroparen. */
export type AuthFailure = z.infer<typeof authFailureSchema>;

/** Bärs som `cause` i serverns UNAUTHORIZED, och läses av `errorFormatter`. */
export class AuthFailureError extends Error {
  constructor(readonly reason: AuthFailure) {
    super(`Ej inloggad: ${reason}`);
    this.name = "AuthFailureError";
  }
}

/** Skälet ur ett `TRPCError`s orsak (servern), eller null. */
export function authFailureFromCause(cause: unknown): AuthFailure | null {
  return cause instanceof AuthFailureError ? cause.reason : null;
}

/** Skälet ur ett tRPC-klientfel (`data.authFailure`), eller null om det saknas. */
export function authFailureOf(err: unknown): AuthFailure | null {
  const data: unknown = typeof err === "object" && err !== null ? Reflect.get(err, "data") : undefined;
  const raw: unknown = typeof data === "object" && data !== null ? Reflect.get(data, "authFailure") : undefined;
  const parsed = authFailureSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
