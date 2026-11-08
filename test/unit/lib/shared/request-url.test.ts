/**
 * `requestUrl` / `requestBodyText` (#1469) — fetch-anropets delar som text,
 * utan "[object Request]" i fejkade fetch:ar.
 */

import { describe, expect, it } from "vitest-compat";
import { requestBodyText, requestUrl } from "@/lib/shared/request-url";

describe("requestUrl", () => {
  it("sträng, URL och Request ger samma URL-text", () => {
    expect(requestUrl("https://x.test/a")).toBe("https://x.test/a");
    expect(requestUrl(new URL("https://x.test/b"))).toBe("https://x.test/b");
    expect(requestUrl(new Request("https://x.test/c"))).toBe("https://x.test/c");
  });
});

describe("requestBodyText", () => {
  it("strängkropp ges som den är, URLSearchParams serialiseras", () => {
    expect(requestBodyText({ body: '{"a":1}' })).toBe('{"a":1}');
    expect(requestBodyText({ body: new URLSearchParams({ grant_type: "code" }) })).toBe("grant_type=code");
  });

  it("saknad eller annan kropp ger tom sträng", () => {
    expect(requestBodyText(undefined)).toBe("");
    expect(requestBodyText({})).toBe("");
    expect(requestBodyText({ body: new Uint8Array([1]) })).toBe("");
  });
});
