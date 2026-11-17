/**
 * Förordnanden ur dokumenttext (#1648): vilka meningsformer som känns igen,
 * och att text utan förordnande inte ger något.
 */

import { describe, it, expect } from "vitest-compat";
import { findAppointments, nameKey } from "@/lib/shared/appointment-extraction";

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
