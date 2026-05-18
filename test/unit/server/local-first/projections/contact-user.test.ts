/**
 * Tester för ContactProjection + UserProjection. Smoke-coverage som
 * visar att Open-closed-principen håller — nya entiteter följer samma
 * mönster som matter och kräver inga ändringar i kernel.
 */

import { describe, it, expect } from "vitest";
import { ContactProjection, type ContactProjectionData } from "@/server/local-first/projections/contact";
import { UserProjection, type UserProjectionData } from "@/server/local-first/projections/user";

describe("ContactProjection", () => {
  const proj = new ContactProjection();
  const sample: ContactProjectionData = {
    id: "c1",
    name: "Anna Klient",
    contactType: "PERSON",
    personalNumber: "19800101-1234",
    email: "anna@x.se",
    organizationId: "org-1",
  };

  it("path är contacts/<id>.json", () => {
    expect(proj.pathFor(sample)).toBe("contacts/c1.json");
  });

  it("round-trip serialize/deserialize", () => {
    expect(proj.deserialize(proj.serialize(sample))).toEqual(sample);
  });

  it("kastar om contactType är okänd", () => {
    expect(() =>
      proj.deserialize('{"id":"x","name":"y","contactType":"BIRD","organizationId":"o"}'),
    ).toThrow();
  });

  it("kastar om id saknas", () => {
    expect(() =>
      proj.deserialize('{"name":"y","contactType":"PERSON","organizationId":"o"}'),
    ).toThrow();
  });
});

describe("UserProjection", () => {
  const proj = new UserProjection();
  const sample: UserProjectionData = {
    id: "u1",
    email: "anna@firma.se",
    name: "Anna Advokat",
    role: "LAWYER",
    sshPublicKeys: ["ssh-ed25519 AAAA..."],
    organizationId: "org-1",
  };

  it("path är .ava/users/<email>.json", () => {
    expect(proj.pathFor(sample)).toBe(".ava/users/anna@firma.se.json");
  });

  it("slugifierar otillåtna tecken i email", () => {
    const tricky = { ...sample, email: "anna+test/illegal@firma.se" };
    expect(proj.pathFor(tricky)).toBe(".ava/users/anna_test_illegal@firma.se.json");
  });

  it("default sshPublicKeys är tom array", () => {
    const noKeys = proj.deserialize(JSON.stringify({ ...sample, sshPublicKeys: undefined }));
    expect(noKeys.sshPublicKeys).toEqual([]);
  });

  it("round-trip serialize/deserialize", () => {
    expect(proj.deserialize(proj.serialize(sample))).toEqual(sample);
  });
});
