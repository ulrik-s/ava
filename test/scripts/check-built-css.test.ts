/**
 * #1166: check-built-css.sh fäller en deploy vars byggda CSS saknar regler ur
 * globals.css (gammal byggcache). #1369: pseudo-element jämförs oberoende av
 * om minifieraren skrev ett eller två kolon. deploy-prod.sh: deploy-prod.test.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest-compat";

const SCRIPT = "tooling/scripts/check-built-css.sh";
const dir = mkdtempSync(join(tmpdir(), "ava-css-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SRC = [
  ".bg-canvas { background-color: #e8edf3; }",
  ".dark .bg-canvas { background-color: #0f172a; }",
  ".dark .divide-gray-100 > * + * { border-color: #1e293b; }",
  ".dv-root .dv-default > span::before { content: ''; }",
  ".field::placeholder { color: gray; }",
  ".dark {",
  "  --color-background: #0f172a;",
  "}",
  "body { color: red; }",
].join("\n");

function run(built: string | null): { status: number | null; out: string } {
  const src = join(dir, "globals.css");
  writeFileSync(src, SRC);
  const args = [SCRIPT, src];
  if (built !== null) {
    const css = join(dir, `built-${Math.random()}.css`);
    writeFileSync(css, built);
    args.push(css);
  }
  const r = spawnSync("bash", args, { encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("check-built-css.sh", () => {
  it("alla selektorer finns (även ihopslagna och minifierade kombinatorer) → ok", () => {
    const built = ".dark{--color-background:#0f172a}.bg-canvas{background-color:#e8edf3}.dark .bg-gray-50,.dark .bg-canvas{background-color:#0f172a}.dark .divide-gray-100>*+*{border-color:#1e293b}.dv-root .dv-default>span::before{content:\"\"}.field::placeholder{color:gray}";
    const r = run(built);
    expect(r.status).toBe(0);
    expect(r.out).toContain("alla selektorer");
  });

  it("gammal CSS utan en ny regel → exit 1 och säger vilken (felet i #1166)", () => {
    const r = run(".dark{--x:1}.dark .bg-canvas{a:b}.dark .divide-gray-100>*+*{a:b}.dv-root .dv-default>span:before{a:b}.field::placeholder{a:b}");
    expect(r.status).toBe(1);
    expect(r.out).toContain("saknas i byggd CSS: .bg-canvas");
    expect(r.out).toContain("Töm .next/cache");
    expect(r.out).toContain("1 selektor(er)");
  });

  it("minifieraren skriver ::before som :before → ingen falsklarm (#1369)", () => {
    const built = ".dark{--x:1}.bg-canvas{a:b}.dark .bg-canvas{a:b}.dark .divide-gray-100>*+*{a:b}.dv-root .dv-default>span:before{content:\"\"}.field:placeholder{a:b}";
    const r = run(built);
    expect(r.status, r.out).toBe(0);
  });

  it("ett pseudo-element som verkligen saknas larmar fortfarande", () => {
    const r = run(".dark{--x:1}.bg-canvas{a:b}.dark .bg-canvas{a:b}.dark .divide-gray-100>*+*{a:b}.dv-root .dv-default>span:after{a:b}.field::placeholder{a:b}");
    expect(r.status).toBe(1);
    expect(r.out).toContain("saknas i byggd CSS: .dv-root .dv-default>span:before");
  });

  it("ingen byggd CSS alls → exit 1", () => {
    const r = run(null);
    expect(r.status).toBe(1);
    expect(r.out).toContain("ingen byggd CSS");
  });
});
