/**
 * Lokala databaser per användare och byrå (#1347): namnen bär byrå + användare,
 * demon delar de gamla namnen, och obundet kastar i stället för att skriva
 * under ett namn en annan användare kan läsa.
 */
import { afterEach, describe, expect, it } from "vitest-compat";
import {
  activeLocalNamespace, activeLocalScope, bindLocalNamespace, dbNameIn, LOCAL_DB, localDbName,
  LocalNamespaceUnboundError, localScopeSchema, sameScope, scopeKey, SHARED_NAMESPACE, unbindLocalNamespace, userNamespace,
} from "@/lib/client/backend/local-data/local-namespace";

const anna = localScopeSchema.parse({ organizationId: "org-1", principalId: "u-anna" });
const bo = localScopeSchema.parse({ organizationId: "org-1", principalId: "u-bo" });

afterEach(() => { bindLocalNamespace(SHARED_NAMESPACE); });

describe("lokala databasnamn", () => {
  it("en användares databaser bär byrå och användare; demons har de gamla namnen", () => {
    expect(dbNameIn(userNamespace(anna), LOCAL_DB.mutationQueue)).toBe("ava-mutation-queue@org-1:u-anna");
    expect(dbNameIn(userNamespace(bo), LOCAL_DB.mutationQueue)).not.toBe(dbNameIn(userNamespace(anna), LOCAL_DB.mutationQueue));
    expect(dbNameIn(SHARED_NAMESPACE, LOCAL_DB.docText)).toBe("ava-doc-text");
  });

  it("inventariet täcker alla databaser med byråns data", () => {
    expect(Object.values(LOCAL_DB).sort()).toEqual([
      "ava-deferred-faktura-docs", "ava-doc-content", "ava-doc-text", "ava-generated-docs",
      "ava-local-store", "ava-mutation-queue", "ava-rejected-changes",
    ]);
  });

  it("scopeKey och sameScope", () => {
    expect(scopeKey(anna)).toBe("org-1:u-anna");
    expect(sameScope(anna, { ...anna })).toBe(true);
    expect(sameScope(anna, bo)).toBe(false);
    expect(sameScope(anna, localScopeSchema.parse({ organizationId: "org-2", principalId: "u-anna" }))).toBe(false);
  });

  it("schemat är strikt: okända fält och tomma id:n avvisas", () => {
    expect(localScopeSchema.safeParse({ organizationId: "o", principalId: "p", extra: 1 }).success).toBe(false);
    expect(localScopeSchema.safeParse({ organizationId: "", principalId: "p" }).success).toBe(false);
  });
});

describe("bindningen", () => {
  it("bunden användare → hennes namn; activeLocalScope ger henne", () => {
    bindLocalNamespace(userNamespace(anna));
    expect(localDbName(LOCAL_DB.localStore)).toBe("ava-local-store@org-1:u-anna");
    expect(activeLocalScope()).toEqual(anna);
    expect(activeLocalNamespace()).toEqual(userNamespace(anna));
  });

  it("demon → ingen användare", () => {
    bindLocalNamespace(SHARED_NAMESPACE);
    expect(activeLocalScope()).toBeNull();
    expect(localDbName(LOCAL_DB.localStore)).toBe("ava-local-store");
  });

  it("obundet → kastar (aldrig ett namn en annan användare kan läsa)", () => {
    unbindLocalNamespace();
    expect(() => localDbName(LOCAL_DB.localStore)).toThrow(LocalNamespaceUnboundError);
    expect(activeLocalScope()).toBeNull();
    expect(() => activeLocalNamespace()).toThrow(/innan inloggningen/);
  });
});
