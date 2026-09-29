/**
 * Ett 401 från servern (#1245) — sessionen gick ut, eller kontot är inte
 * längre aktivt. tRPC ger `data.httpStatus`/`data.code` när servern svarade
 * med JSON; proxyn (oauth2-proxy/nginx) svarar med en naken 401 som bara syns
 * i `meta.response`.
 */

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Är felet ett 401 (utloggad eller spärrad)? */
export function isUnauthorizedError(err: unknown): boolean {
  const data = field(err, "data");
  if (field(data, "httpStatus") === 401 || field(data, "code") === "UNAUTHORIZED") return true;
  return field(field(field(err, "meta"), "response"), "status") === 401;
}
