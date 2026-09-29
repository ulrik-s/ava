/** Minimal typning av js-yaml (saknar egna typer) — det testerna använder. */
declare module "js-yaml" {
  /** Tolka YAML. Resultatet är okontrollerat: smalna av det i anroparen. */
  export function load(text: string): unknown;
  const yaml: { load: typeof load };
  export default yaml;
}
