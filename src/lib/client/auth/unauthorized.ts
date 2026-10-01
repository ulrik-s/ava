/**
 * Ett 401 från servern (#1245) — sessionen gick ut, eller kontot är inte
 * längre aktivt. tRPC ger `data.httpStatus`/`data.code` när servern svarade
 * med JSON; proxyn (oauth2-proxy/nginx) svarar med en naken 401 som bara syns
 * i `meta.response`.
 */

import { httpStatusOf, trpcCodeOf } from "@/lib/shared/sync/sync-error";

/** Är felet ett 401 (utloggad eller spärrad)? */
export function isUnauthorizedError(err: unknown): boolean {
  return httpStatusOf(err) === 401 || trpcCodeOf(err) === "UNAUTHORIZED";
}
