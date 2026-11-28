/**
 * Layoutspråkets tolk (#2251, ADR 0042): en strikt XML-delmängd. Värden som
 * Handlebars escapat avkodas tillbaka till text, och fel anger raden.
 */
import { describe, it, expect } from "vitest-compat";
import { decodeEntities, LayoutError, parseMarkup, type MarkupElement } from "@/lib/shared/documents/markup-parser";

const child = (el: MarkupElement, i: number): MarkupElement => {
  const c = el.children.filter((n): n is MarkupElement => n.kind === "element")[i];
  if (!c) throw new Error(`inget barn ${i}`);
  return c;
};

describe("parseMarkup", () => {
  it("tolkar element, attribut (båda citattyperna), självstängande element och text", () => {
    const root = parseMarkup(`<document title="A" subject='B'>\n  <text size="9">Hej</text>\n  <spacer height="4"/>\n</document>`);
    expect(root).toMatchObject({ name: "document", attrs: { title: "A", subject: "B" }, line: 1 });
    expect(child(root, 0)).toMatchObject({ name: "text", attrs: { size: "9" }, children: [{ kind: "text", text: "Hej" }], line: 2 });
    expect(child(root, 1)).toMatchObject({ name: "spacer", attrs: { height: "4" }, children: [], line: 3 });
  });

  it("avkodar Handlebars-escapade värden i text och attribut", () => {
    const root = parseMarkup(`<text title="&quot;A&quot; &amp; B">&lt;b&gt; &#x27;c&#x27; &#61; &#x60;</text>`);
    expect(root.attrs.title).toBe('"A" & B');
    expect(root.children).toEqual([{ kind: "text", text: "<b> 'c' = `", line: 1 }]);
  });

  it("hoppar över kommentarer", () => {
    const root = parseMarkup(`<document><!-- <text>bort</text> --><text>kvar</text></document>`);
    expect(root.children).toHaveLength(1);
    expect(child(root, 0).name).toBe("text");
  });

  it("ett fristående & står kvar som tecken", () => {
    expect(parseMarkup("<text>A & B &okänd; &#0;</text>").children).toEqual([{ kind: "text", text: "A & B &okänd; &#0;", line: 1 }]);
  });

  const fails = (markup: string, message: RegExp): void => {
    expect(() => parseMarkup(markup)).toThrow(LayoutError);
    expect(() => parseMarkup(markup)).toThrow(message);
  };

  it("felnästlade, ostängda och överflödiga sluttaggar är fel med radnummer", () => {
    fails("<document>\n<text></document>", /Rad 2: <\/document> stänger inget öppet <document> \(öppet element: <text>, rad 2\)/);
    fails("<document>\n<text>", /Rad 2: <text> stängs aldrig/);
    fails("<document></document></document>", /<\/document> stänger inget öppet/);
  });

  it("ett ensamt < är fel", () => {
    fails("<text>1 < 2</text>", /ett "<" som inte inleder ett element/);
  });

  it("dubbla attribut är fel", () => {
    fails(`<text a="1" a="2"/>`, /<text> har attributet "a" två gånger/);
  });

  it("exakt ett rotelement, och ingen text utanför det", () => {
    fails("   ", /inget rotelement/);
    fails("<a/><b/>", /bara ett rotelement är tillåtet/);
    fails("hej <a/>", /text utanför rotelementet/);
  });
});

describe("decodeEntities", () => {
  it("avkodar namngivna och numeriska entiteter", () => {
    expect(decodeEntities("&apos;&gt;&#229;&#xE4;")).toBe("'>åä");
  });
});

describe("LayoutError", () => {
  it("bär namnet LayoutError", () => {
    expect(new LayoutError("x").name).toBe("LayoutError");
  });
});
