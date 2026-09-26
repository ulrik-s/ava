/** Byråns bilder (#1218): data-URL, PNG/JPEG, ≤ 300 kB. Syntetiska bilder. */
import { describe, it, expect } from "vitest-compat";
import { decodeOrgImage, ORG_IMAGE_MAX_BYTES, orgImageSchema } from "@/lib/shared/org-image";
import { TINY_JPEG, TINY_PNG, TINY_PNG_BYTES } from "../../../helpers/tiny-images";

const b64 = (bytes: number): string => Buffer.alloc(bytes).toString("base64");

describe("orgImageSchema", () => {
  it("godtar PNG och JPEG som data-URL", () => {
    expect(orgImageSchema.safeParse(TINY_PNG).success).toBe(true);
    expect(orgImageSchema.safeParse(TINY_JPEG).success).toBe(true);
  });
  it("avvisar andra typer och annat än data-URL", () => {
    expect(orgImageSchema.safeParse("data:image/svg+xml;base64,PHN2Zz4=").success).toBe(false);
    expect(orgImageSchema.safeParse("data:image/gif;base64,R0lGOD").success).toBe(false);
    expect(orgImageSchema.safeParse("https://example.se/logo.png").success).toBe(false);
  });
  it("avvisar bilder över storleksgränsen (räknar base64-utfyllnaden)", () => {
    expect(orgImageSchema.safeParse(`data:image/png;base64,${b64(ORG_IMAGE_MAX_BYTES)}`).success).toBe(true);
    expect(orgImageSchema.safeParse(`data:image/png;base64,${b64(ORG_IMAGE_MAX_BYTES - 1)}`).success).toBe(true);
    expect(orgImageSchema.safeParse(`data:image/png;base64,${b64(ORG_IMAGE_MAX_BYTES - 2)}`).success).toBe(true);
    const tooBig = orgImageSchema.safeParse(`data:image/png;base64,${b64(ORG_IMAGE_MAX_BYTES + 1)}`);
    expect(tooBig.success).toBe(false);
    expect(tooBig.error?.issues[0]?.message).toBe("Bilden får vara högst 300 kB.");
  });
});

describe("decodeOrgImage", () => {
  it("ger typen och de avkodade byten", () => {
    expect(decodeOrgImage(TINY_PNG)).toEqual({ mime: "image/png", bytes: TINY_PNG_BYTES });
    expect(decodeOrgImage(TINY_JPEG).mime).toBe("image/jpeg");
  });
});
