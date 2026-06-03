/**
 * `detectDomAnomalies` — letar efter spår av webbläsartillägg som muterar
 * DOM:en (och andra avvikelser) som kan orsaka hydrerings-mismatch (React
 * #418: "server rendered HTML didn't match the client"). React:s egen
 * #418-text pekar uttryckligen ut tillägg som en vanlig orsak.
 *
 * Ren funktion (tar emot ett Document) så den kan node-testas. `collectMeta`
 * kör den mot `document` och lägger resultatet i felrapporten — så en rapport
 * från en drabbad browser avslöjar VILKET tillägg som störde, istället för att
 * vi gissar.
 */

interface DocLike {
  documentElement?: { getAttributeNames?: () => string[]; className?: string } | null;
  body?: {
    getAttributeNames?: () => string[];
    children?: ArrayLike<{ tagName?: string; id?: string }>;
  } | null;
  querySelector?: (sel: string) => unknown;
}

/** Kända tillägg-signaturer (selektorer / attribut-prefix / klasser). */
const EXTENSION_SIGNS: ReadonlyArray<{ name: string; selectors?: string[]; htmlAttr?: string[]; bodyAttr?: string[]; htmlClass?: string[] }> = [
  { name: "Dark Reader", selectors: ["style.darkreader", "meta[name='darkreader']"], htmlAttr: ["data-darkreader-mode", "data-darkreader-scheme"] },
  { name: "Grammarly", selectors: ["grammarly-desktop-integration", "[data-grammarly-shadow-root]"], bodyAttr: ["data-gr-ext-installed", "data-new-gr-c-s-check-loaded", "data-gr-ext-disabled"] },
  { name: "Google Translate", selectors: ["#goog-gt-tt", ".goog-te-banner-frame", "font[style*='vertical-align']"], htmlClass: ["translated-ltr", "translated-rtl"] },
  { name: "LastPass", selectors: ["[data-lastpass-icon-root]", "[data-lastpass-root]"] },
  { name: "1Password", selectors: ["com-1password-button", "[data-onepassword-extension]"] },
  { name: "Bitwarden", selectors: ["[data-bw-content-loaded]"] },
  { name: "ColorZilla/Stylebot", selectors: ["#stylebot", ".stylebot"] },
];

/** Toppnivå-taggar som är förväntade (Next/React). Allt annat = injicerat. */
const EXPECTED_BODY_TAGS = new Set(["SCRIPT", "NEXT-ROUTE-ANNOUNCER", "DIV"]);

const SUSPECT_ATTR = /darkreader|grammarly|translate|gr-|lastpass|onepassword|-bw-|cz-shortcut/i;

export function detectDomAnomalies(doc: DocLike | null | undefined): string {
  if (!doc) return "";
  const htmlAttrs = safeAttrs(doc.documentElement);
  const bodyAttrs = safeAttrs(doc.body);
  const htmlClass = (doc.documentElement?.className ?? "").split(/\s+/).filter(Boolean);

  const parts = [
    namedExtensions(doc, htmlAttrs, bodyAttrs, htmlClass),
    suspectAttrs("html-attr", htmlAttrs),
    suspectAttrs("body-attr", bodyAttrs),
    extraBodyChildren(doc.body?.children),
  ].filter(Boolean);
  return parts.join("; ");
}

type Sign = (typeof EXTENSION_SIGNS)[number];
interface DomFacts { has: (sel: string) => boolean; htmlAttrs: string[]; bodyAttrs: string[]; htmlClass: string[] }

function matchesExtension(ext: Sign, f: DomFacts): boolean {
  const checks = [
    () => ext.selectors?.some(f.has),
    () => ext.htmlAttr?.some((a) => f.htmlAttrs.includes(a)),
    () => ext.bodyAttr?.some((a) => f.bodyAttrs.includes(a)),
    () => ext.htmlClass?.some((c) => f.htmlClass.includes(c)),
  ];
  return checks.some((c) => c() ?? false);
}

/** Matcha mot kända tillägg-signaturer → "tillägg: A, B" eller "". */
function namedExtensions(doc: DocLike, htmlAttrs: string[], bodyAttrs: string[], htmlClass: string[]): string {
  const has = (sel: string): boolean => {
    try { return typeof doc.querySelector === "function" && doc.querySelector(sel) != null; }
    catch { return false; }
  };
  const facts: DomFacts = { has, htmlAttrs, bodyAttrs, htmlClass };
  const found = EXTENSION_SIGNS.filter((ext) => matchesExtension(ext, facts)).map((e) => e.name);
  return found.length ? `tillägg: ${found.join(", ")}` : "";
}

function suspectAttrs(label: string, attrs: string[]): string {
  const hits = attrs.filter((a) => SUSPECT_ATTR.test(a));
  return hits.length ? `${label}: ${hits.join(",")}` : "";
}

function extraBodyChildren(kids: ArrayLike<{ tagName?: string }> | undefined): string {
  if (!kids) return "";
  const extra = new Set<string>();
  for (let i = 0; i < kids.length; i++) {
    const tag = (kids[i]?.tagName ?? "").toUpperCase();
    if (tag && !EXPECTED_BODY_TAGS.has(tag)) extra.add(tag);
  }
  return extra.size ? `extra body-barn: ${[...extra].join(",")}` : "";
}

function safeAttrs(el: { getAttributeNames?: () => string[] } | null | undefined): string[] {
  try { return typeof el?.getAttributeNames === "function" ? el.getAttributeNames() : []; }
  catch { return []; }
}
