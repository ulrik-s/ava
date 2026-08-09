/**
 * `demoDataBaseUrl` (#932) — var demons data hämtas ifrån.
 *
 * Buggen som testerna vaktar: en `out/` som serverades lokalt NAVIGERADE till
 * localhost men HÄMTADE data från live-demon på GH Pages, eftersom bas-URL:en
 * konstruerades ur repo-STRÄNGEN i stället för ur var appen faktiskt kör. Det
 * gjorde demo-e2e:t nätverksberoende och rött när GH Pages låg nere.
 *
 * Två egenskaper är lika viktiga och drar åt olika håll:
 *   • same-origin när datan ligger bredvid appen (hermetiskt), OCH
 *   • oförändrat beteende när användaren uttryckligen pekar på NÅGON ANNANS
 *     demo — då MÅSTE vi fortsatt gå ut på nätet.
 */
import { describe, it, expect } from "vitest-compat";

import { demoDataBaseUrl } from "@/lib/client/demo/demo-data-base";

/** Bunden till "det här bundlet byggdes för ulrik-s/ava och kör under /ava". */
const pages = {
  origin: "https://ulrik-s.github.io",
  basePath: "/ava",
  buildRepo: "ulrik-s/ava",
  isDemoBuild: true,
} as const;

const local = { ...pages, origin: "http://localhost:8799" } as const;

describe("demoDataBaseUrl — same-origin (regel 3)", () => {
  it("lokalt serverad out/ hämtar från LOCALHOST, inte från github.io", () => {
    // Kärnan i #932. Före fixen gav det här "https://ulrik-s.github.io/ava".
    expect(demoDataBaseUrl("ulrik-s/ava", local)).toBe("http://localhost:8799/ava");
  });

  it("på GH Pages blir URL:en IDENTISK med den gamla konstruktionen", () => {
    // Regressionsvakt: produktionsbeteendet får inte ändras av den här fixen.
    expect(demoDataBaseUrl("ulrik-s/ava", pages)).toBe("https://ulrik-s.github.io/ava");
  });

  it("tomt repo faller tillbaka på bundlets eget → same-origin", () => {
    expect(demoDataBaseUrl("", local)).toBe("http://localhost:8799/ava");
  });

  it("hanterar tom basePath (demo utan bas-sökväg)", () => {
    expect(demoDataBaseUrl("ulrik-s/ava", { ...local, basePath: "" }))
      .toBe("http://localhost:8799");
  });

  it("avslutande snedstreck i repo:t hindrar inte matchningen", () => {
    expect(demoDataBaseUrl("ulrik-s/ava/", local)).toBe("http://localhost:8799/ava");
  });
});

describe("demoDataBaseUrl — annat repo (regel 2)", () => {
  it("pekar config:en på NÅGON ANNANS demo går vi ut på nätet", () => {
    expect(demoDataBaseUrl("ulrik-s/ava-demo", local))
      .toBe("https://ulrik-s.github.io/ava-demo");
  });

  it("full github.com-URL översätts fortfarande till GH Pages", () => {
    expect(demoDataBaseUrl("https://github.com/annan/byra", local))
      .toBe("https://annan.github.io/byra");
  });

  it("en färdig bas-URL returneras som-är", () => {
    expect(demoDataBaseUrl("http://localhost:8080/ava", local))
      .toBe("http://localhost:8080/ava");
  });
});

describe("demoDataBaseUrl — icke-demo-build (regel 1)", () => {
  it("server-/dev-build behåller det gamla beteendet", () => {
    expect(demoDataBaseUrl("ulrik-s/ava", { ...local, isDemoBuild: false }))
      .toBe("https://ulrik-s.github.io/ava");
  });

  it("utan origin (SSR/prerender) gissas GH Pages-URL:en — ingen krasch", () => {
    // Under statisk export körs koden utan `window`; den får inte kasta.
    expect(demoDataBaseUrl("ulrik-s/ava", { ...local, origin: "" }))
      .toBe("https://ulrik-s.github.io/ava");
  });
});
