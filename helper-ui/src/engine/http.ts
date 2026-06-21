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

/** Parsa request-body som JSON; null om det inte är giltig JSON. */
export async function parseJsonBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
