/**
 * Små Response-hjälpare så handler-koden förblir kort. `text`-felen
 * speglar Go:s `http.Error` (text/plain + statuskod).
 */

export function textError(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** `application/json` (med ev. parametrar som `; charset=utf-8`). */
export function isJsonContentType(value: string | null): boolean {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * Parsa request-body som JSON; null om det inte är giltig JSON eller om
 * Content-Type inte är `application/json`. Kravet tvingar en webbläsare att
 * göra en preflight, så ett "enkelt" `text/plain`-anrop aldrig når fram (#1448).
 */
export async function parseJsonBody<T>(req: Request): Promise<T | null> {
  if (!isJsonContentType(req.headers.get("Content-Type"))) return null;
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
