/** `serverUrlOf` (#1838): målet som grinden för helperns token kontrollerar. */
import { describe, expect, test } from "bun:test";

import { asId } from "@/lib/shared/schemas/ids";

import { serverUrlOf } from "../src/engine/document-source.ts";

const document = { id: asId<"DocumentId">("d1"), trpcUrl: "http://localhost:8080/api/trpc" };

describe("serverUrlOf", () => {
  test("document.trpcUrl går före downloadUrl och uploadUrl", () => {
    expect(serverUrlOf({ document, downloadUrl: "https://a.example/d", uploadUrl: "https://a.example/u" })).toBe("http://localhost:8080/api/trpc");
  });

  test("downloadUrl går före uploadUrl", () => {
    expect(serverUrlOf({ downloadUrl: "https://a.example/d", uploadUrl: "https://a.example/u" })).toBe("https://a.example/d");
  });

  test("uploadUrl ensam", () => {
    expect(serverUrlOf({ uploadUrl: "https://a.example/u" })).toBe("https://a.example/u");
  });

  test("utan källa → tom sträng", () => {
    expect(serverUrlOf({})).toBe("");
  });
});
