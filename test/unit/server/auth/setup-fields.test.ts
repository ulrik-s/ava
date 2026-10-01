/**
 * Setup-fältens policy (#1345): bara ADMIN, aldrig i ett köat anrop.
 */
import { describe, expect, it } from "vitest-compat";
import { assertSetupFieldsAllowed, onBehalfOf, presentSetupFields, type SetupFieldCaller } from "@/lib/server/auth/setup-fields";
import { asId } from "@/lib/shared/schemas/ids";

const ME = asId<"UserId">("u-me");
const lawyer: SetupFieldCaller = { user: { id: ME, role: "LAWYER" } };
const admin: SetupFieldCaller = { user: { id: ME, role: "ADMIN" } };
const queued = { mutationId: "019a0000-0000-7000-8000-000000000004", at: 0 };

describe("presentSetupFields", () => {
  it("undefined och null räknas som inte skickade", () => {
    expect(presentSetupFields({ a: undefined, b: null, c: 0, d: "", e: false })).toEqual(["c", "d", "e"]);
  });
});

describe("onBehalfOf", () => {
  it("eget id eller inget id är inget setup-fält; någon annans är det", () => {
    expect(onBehalfOf(lawyer, undefined)).toBeUndefined();
    expect(onBehalfOf(lawyer, ME)).toBeUndefined();
    expect(onBehalfOf(lawyer, asId<"UserId">("u-other"))).toBe("u-other");
  });
});

describe("assertSetupFieldsAllowed", () => {
  it("utan setup-fält: alla får, också köat", () => {
    expect(() => assertSetupFieldsAllowed({ ...lawyer, queued }, { hourlyRate: undefined })).not.toThrow();
  });

  it("ADMIN i ett direkt anrop får sätta dem", () => {
    expect(() => assertSetupFieldsAllowed(admin, { hourlyRate: 1, matterNumber: "X" })).not.toThrow();
  });

  it("icke-admin: FORBIDDEN, och felet namnger fälten", () => {
    expect(() => assertSetupFieldsAllowed(lawyer, { hourlyRate: 1, createdAt: "2020-01-01" }))
      .toThrow(expect.objectContaining({ code: "FORBIDDEN", message: "Endast administratörer kan sätta: hourlyRate, createdAt." }));
  });

  it("köat anrop: FORBIDDEN även för ADMIN", () => {
    expect(() => assertSetupFieldsAllowed({ ...admin, queued }, { status: "CLOSED" }))
      .toThrow(expect.objectContaining({ code: "FORBIDDEN", message: expect.stringContaining("synkad ändring: status") }));
  });
});
