/**
 * Delarna av ett fetch-anrop som text (#1469, `no-base-to-string`): `Request`
 * saknar egen toString, så `String(input)` gav "[object Request]" i fejkade
 * fetch:ar. Används av fetch-fakes i test och av tooling:s fil-fetch.
 */

/** URL:en oavsett om anropet gavs som sträng, URL eller Request. */
export function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return "href" in input ? input.href : input.url;
}

/** Kroppen som text — sträng eller URLSearchParams (det fakes skickar); annat ger "". */
export function requestBodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body === "string") return body;
  return body instanceof URLSearchParams ? body.toString() : "";
}
