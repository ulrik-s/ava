import { describe, expect, test } from "bun:test";

import { json, parseJsonBody, textError } from "../src/engine/http.ts";
import { jsonRequest, mkRequest } from "./helpers.ts";

describe("textError", () => {
  test("sätter status + text/plain + nyrad", async () => {
    const res = textError(404, "not found");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("not found\n");
  });
});

describe("json", () => {
  test("serialiserar body + default 200", async () => {
    const res = json({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ a: 1 });
  });
  test("respekterar explicit status", () => {
    expect(json({}, 202).status).toBe(202);
  });
});

describe("parseJsonBody", () => {
  test("parsar giltig JSON", async () => {
    const body = await parseJsonBody<{ x: number }>(jsonRequest("/x", { x: 5 }));
    expect(body).toEqual({ x: 5 });
  });
  test("null vid ogiltig JSON", async () => {
    const body = await parseJsonBody(mkRequest("/x", { method: "POST", body: "not-json" }));
    expect(body).toBeNull();
  });
});
