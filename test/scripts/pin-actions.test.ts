/**
 * `pin-actions` (#910) — SHA-pinning av GitHub Actions. Den rena logiken testas
 * här; `gh`-uppslaget och filskrivningen är I/O-skalet.
 *
 * Varför det spelar roll att detaljerna är rätt: en FEL SHA ger röd CI och
 * `main` kräver grön CI för merge, så ett slarvigt omskrivet `uses:` blockerar
 * allt arbete. Och en rad som tystnar (lämnas opinnad utan att någon märker det)
 * ger falsk trygghet — därför `--check`.
 */
import { describe, it, expect } from "vitest-compat";
import {
  actionRefsIn, applyPins, isSha, lookupTag, parseUsesLine, shaFromLsRemote, unpinned,
} from "../../tooling/scripts/pin-actions";

const SHA = "08c6903cd8c0fde910a37f88322edcfb5dd907a8";
const SHA2 = "11bd71901bbe5b1630ceea73d27597364c9af683";

describe("isSha", () => {
  it("accepterar full 40-teckens SHA, inget annat", () => {
    expect(isSha(SHA)).toBe(true);
    expect(isSha("v7")).toBe(false);
    expect(isSha(SHA.slice(0, 7))).toBe(false); // kort SHA räcker inte
    expect(isSha(SHA.toUpperCase())).toBe(false); // gh ger gemener
  });
});

describe("parseUsesLine", () => {
  it("tolkar en vanlig taggad action", () => {
    expect(parseUsesLine("      - uses: actions/checkout@v7")).toMatchObject({
      repo: "actions/checkout", subpath: "", ref: "v7", comment: "",
    });
  });

  it("bevarar underkatalogen för monorepo-actions", () => {
    // github/codeql-action/init slås upp på github/codeql-action, men sökvägen
    // måste tillbaka in i raden — annars pekar den på fel action.
    expect(parseUsesLine("      - uses: github/codeql-action/init@v4")).toMatchObject({
      repo: "github/codeql-action", subpath: "/init", ref: "v4",
    });
  });

  it("läser versionskommentaren på en redan pinnad rad", () => {
    expect(parseUsesLine(`      - uses: actions/checkout@${SHA} # v7`)).toMatchObject({
      repo: "actions/checkout", ref: SHA, comment: "v7",
    });
  });

  it("hoppar över LOKALA actions — de är vår egen kod", () => {
    expect(parseUsesLine("      - uses: ./.github/actions/bun-setup")).toBeNull();
    expect(parseUsesLine("      - uses: ./.github/workflows/reusable.yml")).toBeNull();
  });

  it("hoppar över docker-actions (pinnas med digest, annat format)", () => {
    expect(parseUsesLine("      - uses: docker://alpine:3.19")).toBeNull();
  });

  it("hoppar över rader utan ref och rader som inte är uses:", () => {
    expect(parseUsesLine("      - uses: actions/checkout")).toBeNull();
    expect(parseUsesLine("      - name: Checkout")).toBeNull();
    expect(parseUsesLine("  # uses: actions/checkout@v7")).toBeNull();
  });

  it("tolkar uses: utan inledande bindestreck (composite-actions)", () => {
    expect(parseUsesLine("    uses: oven-sh/setup-bun@v2")).toMatchObject({
      repo: "oven-sh/setup-bun", ref: "v2",
    });
  });
});

describe("lookupTag", () => {
  it("opinnad rad slås upp på sin egen ref", () => {
    expect(lookupTag(parseUsesLine("- uses: actions/cache@v4")!)).toBe("v4");
  });

  it("pinnad rad slås upp på VERSIONSKOMMENTAREN — så en bump blir möjlig", () => {
    expect(lookupTag(parseUsesLine(`- uses: actions/cache@${SHA} # v4`)!)).toBe("v4");
  });

  it("pinnad rad UTAN kommentar lämnas orörd — vi får inte gissa versionen", () => {
    expect(lookupTag(parseUsesLine(`- uses: actions/cache@${SHA}`)!)).toBeNull();
  });
});

describe("actionRefsIn", () => {
  it("plockar alla pinnbara referenser och bara dem", () => {
    const yaml = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@v7",
      "      - uses: ./.github/actions/bun-setup",
      "      - uses: github/codeql-action/init@v4",
      "      - name: Bygg",
      "        run: bun run build",
    ].join("\n");
    expect(actionRefsIn(yaml).map((r) => r.repo)).toEqual(["actions/checkout", "github/codeql-action"]);
  });
});

describe("applyPins", () => {
  const resolved = new Map([["actions/checkout@v7", SHA], ["github/codeql-action@v4", SHA2]]);

  it("skriver om till SHA och behåller versionen som kommentar", () => {
    const out = applyPins("      - uses: actions/checkout@v7", resolved);
    expect(out).toBe(`      - uses: actions/checkout@${SHA} # v7`);
  });

  it("bevarar indentering och underkatalog", () => {
    const out = applyPins("        - uses: github/codeql-action/init@v4", resolved);
    expect(out).toBe(`        - uses: github/codeql-action/init@${SHA2} # v4`);
  });

  it("bumpar en redan pinnad rad när taggen flyttats", () => {
    const stale = `      - uses: actions/checkout@${SHA2} # v7`;
    expect(applyPins(stale, resolved)).toBe(`      - uses: actions/checkout@${SHA} # v7`);
  });

  it("är idempotent — samma SHA ger identisk fil", () => {
    const pinned = `      - uses: actions/checkout@${SHA} # v7`;
    expect(applyPins(pinned, resolved)).toBe(pinned);
  });

  it("lämnar en referens ORÖRD när uppslaget misslyckades", () => {
    // Hellre kvar på taggen än pinnad till en gissad SHA: fel SHA = röd CI.
    const line = "      - uses: softprops/action-gh-release@v3";
    expect(applyPins(line, resolved)).toBe(line);
  });

  it("rör inte rader som inte är actions", () => {
    const yaml = ["      - name: Checkout", "        run: echo uses: actions/checkout@v7"].join("\n");
    expect(applyPins(yaml, resolved)).toBe(yaml);
  });

  it("skriver om alla rader i en hel fil utan att tappa struktur", () => {
    const before = [
      "name: CI",
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@v7",
      "      - uses: ./.github/actions/bun-setup",
      "      - uses: github/codeql-action/init@v4",
      "",
    ].join("\n");
    const after = applyPins(before, resolved);
    expect(after.split("\n")).toHaveLength(before.split("\n").length);
    expect(after).toContain(`actions/checkout@${SHA} # v7`);
    expect(after).toContain("uses: ./.github/actions/bun-setup"); // lokal orörd
    expect(after).toContain(`github/codeql-action/init@${SHA2} # v4`);
  });
});

describe("unpinned", () => {
  it("returnerar bara de referenser som ännu inte är SHA-pinnade", () => {
    const refs = actionRefsIn([
      "      - uses: actions/checkout@v7",
      `      - uses: actions/cache@${SHA} # v4`,
    ].join("\n"));
    expect(unpinned(refs).map((r) => r.ref)).toEqual(["v7"]);
  });
});

/**
 * `git ls-remote`-vägen (fallback när `gh` saknas, t.ex. bakom en git-proxy där
 * GitHub-API:et är blockerat). Den kritiska detaljen är PEELINGEN: en annoterad
 * tagg är ett eget objekt, och pinnas actionen till tagg-objektets SHA i stället
 * för commitens blir referensen fel. Två av repots actions har annoterade taggar
 * (softprops/action-gh-release, github/codeql-action), så det är inte hypotetiskt.
 */
describe("shaFromLsRemote", () => {
  it("lightweight-tagg → commiten direkt (ingen ^{}-rad finns)", () => {
    const out = `${SHA}\trefs/tags/v7\n`;
    expect(shaFromLsRemote(out, "v7")).toBe(SHA);
  });

  it("ANNOTERAD tagg → den PEELADE commiten, inte tagg-objektet", () => {
    const out = [`${SHA}\trefs/tags/v3`, `${SHA2}\trefs/tags/v3^{}`, ""].join("\n");
    expect(shaFromLsRemote(out, "v3")).toBe(SHA2);
  });

  it("peelad rad vinner även när den kommer FÖRST i utdatan", () => {
    const out = [`${SHA2}\trefs/tags/v3^{}`, `${SHA}\trefs/tags/v3`, ""].join("\n");
    expect(shaFromLsRemote(out, "v3")).toBe(SHA2);
  });

  it("matchar exakt tagg — v4 plockar inte v4.1 eller v40", () => {
    const out = [`${SHA}\trefs/tags/v4.1`, `${SHA2}\trefs/tags/v40`, ""].join("\n");
    expect(shaFromLsRemote(out, "v4")).toBeNull();
  });

  it("BRANCH-ref löses också — en del actions publicerar majorn som branch", () => {
    // actions/dependency-review-action@v4 är en branch, ingen tagg. `gh api
    // repos/x/commits/v4` löser den, så git-vägen måste göra det också.
    const out = `${SHA}\trefs/heads/v4\n`;
    expect(shaFromLsRemote(out, "v4")).toBe(SHA);
  });

  it("tagg vinner över branch med samma namn — taggen är den avsedda utgåvan", () => {
    const out = [`${SHA2}\trefs/heads/v4`, `${SHA}\trefs/tags/v4`, ""].join("\n");
    expect(shaFromLsRemote(out, "v4")).toBe(SHA);
  });

  it("tom eller skräpig utdata ger null i stället för en gissning", () => {
    expect(shaFromLsRemote("", "v7")).toBeNull();
    expect(shaFromLsRemote("fatal: repository not found\n", "v7")).toBeNull();
    expect(shaFromLsRemote("nothex\trefs/tags/v7\n", "v7")).toBeNull();
  });
});
