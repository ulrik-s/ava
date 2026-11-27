/** `seesAllTime` (#2114): bara Admin ser allas tider på Tidregistrering. */
import { describe, expect, it } from "vitest-compat";
import { seesAllTime } from "@/lib/shared/report-subject";
import { USER_ROLE_LABELS, type UserRole } from "@/lib/shared/schemas/enums";

describe("seesAllTime", () => {
  it("bara ADMIN ser allas tider, för varje roll i USER_ROLE_LABELS", () => {
    const roles = Object.keys(USER_ROLE_LABELS) as UserRole[];
    expect(Object.fromEntries(roles.map((r) => [r, seesAllTime(r)]))).toEqual({
      ADMIN: true, LAWYER: false, ASSISTANT: false,
    });
  });
});
