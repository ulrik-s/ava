import { describe, it, expect } from "vitest-compat";
import {
  probeUserinfo,
  resolveSelfHostedPrincipal,
  classifyOidcLogin,
  OIDC_USERINFO_PATH,
} from "@/lib/client/backend/oidc-principal";
import type { AllowlistedUser } from "@/lib/server/auth/oidc-auth-provider";
import { fetchFake } from "../../../helpers/fetch-fake";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const USERS: AllowlistedUser[] = [
  { id: "u-1", email: "anna@byra.se", name: "Anna", role: "ADMIN", organizationId: "org-1" },
];

describe("probeUserinfo (#1245)", () => {
  it("inloggad: email + namn ur userinfo, utan att följa omdirigeringar", async () => {
    const fetchFn = fetchFake(async (path: string | URL | Request, init?: RequestInit) => {
      expect(String(path)).toBe(OIDC_USERINFO_PATH);
      expect(init?.redirect).toBe("manual");
      return jsonRes(200, { email: "anna@byra.se", user: "anna", preferredUsername: "Anna A" });
    });
    expect(await probeUserinfo(fetchFn)).toEqual({ kind: "ok", claims: { email: "anna@byra.se", subject: "", issuer: "", name: "Anna A" } });
  });

  it("namn faller tillbaka på user när preferredUsername saknas", async () => {
    const res = await probeUserinfo(fetchFake(async () => jsonRes(200, { email: "x@y.se", user: "x" })));
    expect(res).toMatchObject({ kind: "ok", claims: { name: "x" } });
  });

  it("401/403 eller en omdirigering → utloggad", async () => {
    expect(await probeUserinfo(fetchFake(async () => jsonRes(401, {})))).toEqual({ kind: "unauthenticated" });
    expect(await probeUserinfo(fetchFake(async () => jsonRes(403, {})))).toEqual({ kind: "unauthenticated" });
    const redirect = { type: "opaqueredirect", ok: false, status: 0 } as Response;
    expect(await probeUserinfo(fetchFake(async () => redirect))).toEqual({ kind: "unauthenticated" });
  });

  it("svar utan email, eller trasig JSON → utloggad", async () => {
    expect(await probeUserinfo(fetchFake(async () => jsonRes(200, { user: "x" })))).toEqual({ kind: "unauthenticated" });
    const broken = new Response("{", { status: 200, headers: { "content-type": "application/json" } });
    expect(await probeUserinfo(fetchFake(async () => broken))).toEqual({ kind: "unauthenticated" });
  });

  it("nätverksfel eller 5xx (proxy/IdP nere) → nås inte", async () => {
    expect(await probeUserinfo(fetchFake(async () => { throw new TypeError("Failed to fetch"); }))).toEqual({ kind: "unreachable" });
    expect(await probeUserinfo(fetchFake(async () => jsonRes(502, {})))).toEqual({ kind: "unreachable" });
  });

  it("ingen oauth2-proxy i driften: 404, eller app-skalets HTML → ingen session att fråga om", async () => {
    expect(await probeUserinfo(fetchFake(async () => jsonRes(404, {})))).toEqual({ kind: "absent" });
    const html = new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
    expect(await probeUserinfo(fetchFake(async () => html))).toEqual({ kind: "absent" });
  });
});

describe("resolveSelfHostedPrincipal", () => {
  it("matchar email mot allowlisten → principal", () => {
    const p = resolveSelfHostedPrincipal(
      { email: "anna@byra.se", subject: "", issuer: "", name: "Anna" },
      USERS,
    );
    expect(p?.id).toBe("u-1");
    expect(p?.role).toBe("ADMIN");
  });

  it("null claims → null", () => {
    expect(resolveSelfHostedPrincipal(null, USERS)).toBeNull();
  });

  it("okänd email → null (ej allowlistad)", () => {
    const p = resolveSelfHostedPrincipal(
      { email: "okand@byra.se", subject: "", issuer: "", name: "" },
      USERS,
    );
    expect(p).toBeNull();
  });
});

describe("classifyOidcLogin", () => {
  it("inga claims → no-session (icke-OIDC/ej inloggad)", () => {
    expect(classifyOidcLogin(null, USERS)).toEqual({ kind: "no-session" });
  });

  it("allowlistad email → authorized med principal", () => {
    const out = classifyOidcLogin({ email: "anna@byra.se", subject: "", issuer: "", name: "Anna" }, USERS);
    expect(out.kind).toBe("authorized");
    if (out.kind === "authorized") expect(out.principal.id).toBe("u-1");
  });

  it("autentiserad men ej allowlistad → denied med email", () => {
    const out = classifyOidcLogin({ email: "intrang@annan.se", subject: "", issuer: "", name: "" }, USERS);
    expect(out).toEqual({ kind: "denied", email: "intrang@annan.se" });
  });
});
