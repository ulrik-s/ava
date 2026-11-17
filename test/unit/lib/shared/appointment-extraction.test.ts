/**
 * Förordnanden ur dokumenttext (#1648): vilka meningsformer som känns igen,
 * och att text utan förordnande inte ger något.
 */

import { describe, it, expect } from "vitest-compat";
import { findAppointments, nameKey, otherPartyRole, sideMarkers, sideOf } from "@/lib/shared/appointment-extraction";

describe("findAppointments", () => {
  it("läser aktiv form: domstolen förordnar advokaten X som … för Y", () => {
    const [a] = findAppointments("Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek, 900101-1234.");
    expect(a).toMatchObject({
      appointee: "Per Holm", assignment: "offentlig försvarare",
      client: "Lisa Ek", tail: ", 900101-1234",
    });
  });

  it("läser passiv form: X förordnas som … för Y", () => {
    const [a] = findAppointments("Eva Sand förordnas som målsägandebiträde för Nils Berg.");
    expect(a).toMatchObject({ appointee: "Eva Sand", assignment: "målsägandebiträde", client: "Nils Berg" });
  });

  it("läser 'har förordnats' och skalar titeln ur advokatens namn", () => {
    const [a] = findAppointments("Advokaten Eva Sand har förordnats som särskild företrädare för barnet Moa Berg.");
    expect(a).toMatchObject({ appointee: "Eva Sand", assignment: "särskild företrädare", client: "Moa Berg" });
  });

  it("läser meningen även när den bryts över flera rader", () => {
    const [a] = findAppointments("Tingsrätten förordnar\nadvokaten Per Holm som offentlig\nförsvarare för den tilltalade Lisa Ek.");
    expect(a).toMatchObject({ appointee: "Per Holm", assignment: "offentlig försvarare", client: "Lisa Ek" });
  });

  it("klientens namn och resten av meningen stannar vid radslutet", () => {
    const [a] = findAppointments("Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek\nMålsägande: Nils Berg 850101-1111");
    expect(a).toMatchObject({ client: "Lisa Ek", tail: "" });
    expect(a?.sentence).toBe("förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek");
  });

  it("klientens namn får stå på raden efter 'för', och radbrytningen blir mellanslag", () => {
    const [a] = findAppointments("Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för\nLisa Ek, 900101-1234");
    expect(a).toMatchObject({ client: "Lisa Ek", tail: ", 900101-1234" });
    expect(a?.sentence).toBe("förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek, 900101-1234");
  });

  it("en tom rad avslutar meningen", () => {
    expect(findAppointments("Tingsrätten förordnar advokaten Per Holm som offentlig försvarare\n\nför Lisa Ek.")).toEqual([]);
  });

  it("ger förordnandena i den ordning de står i texten", () => {
    const text = [
      "Eva Sand förordnas som målsägandebiträde för Nils Berg.",
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
    ].join("\n");
    expect(findAppointments(text).map((a) => a.client)).toEqual(["Nils Berg", "Lisa Ek"]);
  });

  it("text utan förordnande ger inget", () => {
    expect(findAppointments("Tingsrätten har förordnat en sakkunnig.")).toEqual([]);
    expect(findAppointments("Ombud: Advokat Per Holm")).toEqual([]);
  });
});

describe("nameKey", () => {
  it("jämför namn utan titel, skiftläge eller extra mellanslag", () => {
    expect(nameKey("Advokat  Per Holm ")).toBe("per holm");
    expect(nameKey("advokaten Per Holm")).toBe("per holm");
    expect(nameKey("Jur. kand. Per Holm")).toBe("per holm");
    expect(nameKey("Per Holm")).toBe("per holm");
  });
});

describe("uppdragets sida och de andra parternas roller (#1649)", () => {
  it("sideOf: försvarare → tilltalads sida, målsägandebiträde → målsägandens, annat → null", () => {
    expect(sideOf("offentlig försvarare")).toBe("TILLTALAD");
    expect(sideOf("målsägandebiträde")).toBe("MALSAGANDE");
    expect(sideOf("särskild företrädare")).toBeNull();
  });

  it("otherPartyRole: försvarare ger Medtilltalad/Motpart, målsägandebiträde ger Motpart", () => {
    expect(otherPartyRole("TILLTALAD", "TILLTALAD")).toBe("MEDTILLTALAD");
    expect(otherPartyRole("TILLTALAD", "MALSAGANDE")).toBe("MOTPART");
    expect(otherPartyRole("MALSAGANDE", "TILLTALAD")).toBe("MOTPART");
    expect(otherPartyRole("MALSAGANDE", "MALSAGANDE")).toBeNull();
    expect(otherPartyRole(null, "TILLTALAD")).toBeNull();
    expect(otherPartyRole("TILLTALAD", null)).toBeNull();
  });

  it("sideMarkers: misstänkt räknas som tilltalad, målsägandebiträde är ingen målsägande", () => {
    const defence = sideMarkers("TILLTALAD");
    const roleFor = (text: string): string | undefined => defence.find(([p]) => p.test(text))?.[1];
    expect(roleFor("Misstänkt: X")).toBe("MEDTILLTALAD");
    expect(roleFor("Tilltalade")).toBe("MEDTILLTALAD");
    expect(roleFor("Målsägande: Y")).toBe("MOTPART");
    expect(roleFor("Målsägandebiträde: Z")).toBeUndefined();
    expect(sideMarkers("MALSAGANDE").map(([, role]) => role)).toEqual(["MOTPART"]);
  });
});
