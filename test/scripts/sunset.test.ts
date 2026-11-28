/**
 * Solnedgångsregistret (#2040): en ersatt mekanism som ligger kvar efter sin
 * sista dag fäller, en post utan spår ska strykas, och en ny ADR som ersätter
 * något måste ha en post.
 */
import { describe, expect, it } from "vitest-compat";
import { stockholmDay } from "@/lib/shared/stockholm-time";
import {
  adrHeader, adrNumber, checkAdrs, checkGone, checkSunset, entryHits, readAdrs, readRegistry, readSourceFiles,
  sunsetEntrySchema, type SunsetEntry,
} from "../../tooling/scripts/sunset";

const entry: SunsetEntry = {
  mechanism: "gamla typen",
  adr: 39,
  issue: "#123",
  lastDay: "2027-01-31",
  traces: ["documentType", "document_type"],
  paths: ["src/"],
  exclude: ["src/db/schema"],
};

const files = [
  { path: "src/a.ts", text: "const x = row.documentType;" },
  { path: "src/b.ts", text: "filter({ documentTypes, documentTypeFilter })" },
  { path: "src/db/schema-core.ts", text: "document_type: text()" },
  { path: "test/c.ts", text: "documentType" },
];

describe("schemat", () => {
  it("godtar en giltig post och sätter exclude till tom lista", () => {
    const { exclude: _exclude, ...rest } = entry;
    expect(sunsetEntrySchema.parse(rest).exclude).toEqual([]);
    expect(sunsetEntrySchema.parse({ ...entry, issue: "ava-feedback#57" }).issue).toBe("ava-feedback#57");
  });

  it.each([
    ["ett felaktigt datum", { lastDay: "2027-02-30" }],
    ["ett datum i fel form", { lastDay: "31/1 2027" }],
    ["en tom traces", { traces: [] }],
    ["ett adr som inte är ett heltal", { adr: 38.5 }],
    ["en issue i fel form", { issue: "57" }],
    ["inga paths", { paths: [] }],
  ])("vägrar %s", (_label, patch) => {
    expect(sunsetEntrySchema.safeParse({ ...entry, ...patch }).success).toBe(false);
  });
});

describe("entryHits", () => {
  it("matchar hela ord, hoppar över exclude och sökvägar utanför paths", () => {
    expect(entryHits(entry, files)).toEqual(["src/a.ts"]);
  });

  it("utan exclude räknas schemafilen", () => {
    expect(entryHits({ ...entry, exclude: [] }, files)).toEqual(["src/a.ts", "src/db/schema-core.ts"]);
  });

  it("specialtecken i spåren matchas bokstavligt", () => {
    expect(entryHits({ ...entry, traces: ["a.b"] }, [{ path: "src/x.ts", text: "axb" }])).toEqual([]);
    expect(entryHits({ ...entry, traces: ["a.b"] }, [{ path: "src/x.ts", text: "a.b" }])).toEqual(["src/x.ts"]);
  });
});

describe("checkSunset", () => {
  it.each(["2027-01-30", "2027-01-31"])("före och på sista dagen (%s): inget fel", (today) => {
    expect(checkSunset([entry], files, today)).toEqual([]);
  });

  it("dagen efter: fel som nämner posten, issuen, sista dagen och filerna", () => {
    const [error, ...rest] = checkSunset([entry], files, "2027-02-01");
    expect(rest).toEqual([]);
    for (const part of ["gamla typen", "#123", "2027-01-31", "src/a.ts"]) expect(error).toContain(part);
  });

  it("efter sista dagen utan träffar: inget solnedgångsfel (det fäller som gone)", () => {
    expect(checkSunset([entry], [], "2027-02-01")).toEqual([]);
  });
});

describe("checkGone", () => {
  it("en post med träffar: inget fel", () => {
    expect(checkGone([entry], files)).toEqual([]);
  });

  it("en post utan träffar ska strykas", () => {
    expect(checkGone([entry], [{ path: "src/a.ts", text: "kinds" }])).toEqual([expect.stringContaining("gamla typen")]);
  });
});

describe("ADR-kontrollen", () => {
  const headerForm = "# ADR 0039 — X\n\n**Status:** Antagen\n**Ersätter:** något\n\n## Kontext\n";
  const bulletForm = "# ADR 0039 — X\n\n- **Status:** Antagen\n- **Ersätter:** något\n\n## Kontext\n";
  const inBody = "# ADR 0039 — X\n\n**Status:** Antagen\n\n## Kontext\n\n**Ersätter:** något\n";

  it.each([
    ["rubrikraden", headerForm],
    ["punktformen", bulletForm],
  ])("en ADR 0039 med Ersätter i %s utan post fäller, med post går den igenom", (_label, text) => {
    const adrs = [{ name: "0039-x.md", text }];
    expect(checkAdrs([], adrs)).toEqual([expect.stringContaining("0039-x.md")]);
    expect(checkAdrs([entry], adrs)).toEqual([]);
  });

  it("en ADR under 0039 hoppas över", () => {
    expect(checkAdrs([], [{ name: "0038-x.md", text: headerForm }])).toEqual([]);
  });

  it("Ersätter efter första ## räknas inte", () => {
    expect(checkAdrs([], [{ name: "0040-x.md", text: inBody }])).toEqual([]);
  });

  it("filer som inte är ADR:er hoppas över", () => {
    expect(checkAdrs([], [{ name: "README.md", text: headerForm }])).toEqual([]);
  });

  it("adrHeader och adrNumber", () => {
    expect(adrHeader("a\n## b\nc")).toBe("a\n");
    expect(adrHeader("bara huvud")).toBe("bara huvud");
    expect(adrNumber("0041-trpc.md")).toBe(41);
    expect(adrNumber("template.md")).toBeNull();
  });
});

describe("grinden mot repot", () => {
  const registry = readRegistry();
  const sources = readSourceFiles(registry);

  it("registret på disk är giltigt och har posten för ADR 0038", () => {
    expect(registry.map((e) => e.adr)).toContain(38);
  });

  it("posten för ADR 0038 har träffar i src/ i dag, och ingen post är borta", () => {
    const adr38 = registry.find((e) => e.adr === 38);
    expect(adr38 && entryHits(adr38, sources).length).toBeGreaterThan(0);
    expect(checkGone(registry, sources)).toEqual([]);
  });

  it("ingen post har passerat sin sista dag", () => {
    expect(checkSunset(registry, sources, stockholmDay(new Date()))).toEqual([]);
  });

  it("ingen ADR från 0039 som ersätter något saknar post", () => {
    expect(checkAdrs(registry, readAdrs())).toEqual([]);
  });
});
