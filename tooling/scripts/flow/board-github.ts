/**
 * Projekttavlan i GitHub (Projects v2, GraphQL via `gh api graphql`).
 * `projectBoard` hittar eller skapar projektet, ser till att Status-fältet har
 * tavlans kolumner, att Prio-fältet och en tavelvy finns, och läser och sätter
 * korten. Kräver en klassisk PAT med `project` och `repo` (ett användarägt
 * projekt nås inte med en fine-grained token eller GITHUB_TOKEN).
 */
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { type Column, COLUMNS, type Prio, PRIOS } from "./board";
import type { GhRunner } from "./github";

/** Ett kort på tavlan. */
export interface BoardItem { itemId: string; number: number; repo: string; open: boolean; column: string | null; prio: string | null }

/** Det synken behöver av tavlan. */
export interface BoardApi {
  url: string;
  items(): BoardItem[];
  add(contentId: string): string;
  setColumn(itemId: string, column: Column): void;
  setPrio(itemId: string, prio: Prio): void;
  archive(itemId: string): void;
}

interface Option { name: string; color: string; description: string }

const selectField = z.object({ id: z.string(), name: z.string(), options: z.array(z.object({ id: z.string(), name: z.string() })) });
type SelectField = z.infer<typeof selectField>;
const anyField = z.union([selectField, z.looseObject({})]);

function gql<T extends z.ZodType>(run: GhRunner, schema: T, query: string, vars: Record<string, string> = {}): z.output<T> {
  const args = ["api", "graphql", "-f", `query=${query}`, ...Object.entries(vars).flatMap(([k, v]) => ["-f", `${k}=${v}`])];
  return schema.parse(parseJsonWith(z.object({ data: z.unknown() }), run(args)).data);
}

const literal = (opts: readonly Option[]): string =>
  `[${opts.map((o) => `{name:${JSON.stringify(o.name)},color:${o.color},description:${JSON.stringify(o.description)}}`).join(",")}]`;

const PRIO_OPTIONS: readonly Option[] = PRIOS.map((p, i) => ({ name: p, color: ["RED", "YELLOW", "GREEN"][i] ?? "GRAY", description: `prio-${p}` }));

const project = z.object({ id: z.string(), number: z.number(), title: z.string(), url: z.string() });

function findOrCreateProject(run: GhRunner, owner: string, title: string, log: (l: string) => void): z.infer<typeof project> {
  const user = gql(run, z.object({ user: z.object({ id: z.string(), projectsV2: z.object({ nodes: z.array(project) }) }) }),
    "query($login:String!){user(login:$login){id projectsV2(first:50){nodes{id number title url}}}}", { login: owner }).user;
  const found = user.projectsV2.nodes.find((p) => p.title === title);
  if (found) return found;
  log(`skapar projektet "${title}"`);
  return gql(run, z.object({ createProjectV2: z.object({ projectV2: project }) }),
    "mutation($owner:ID!,$title:String!){createProjectV2(input:{ownerId:$owner,title:$title}){projectV2{id number title url}}}",
    { owner: user.id, title }).createProjectV2.projectV2;
}

const SELECT_FIELD = "... on ProjectV2SingleSelectField{id name options{id name}}";

function readFields(run: GhRunner, projectId: string): { fields: SelectField[]; hasBoard: boolean } {
  const node = gql(run, z.object({ node: z.object({
    fields: z.object({ nodes: z.array(anyField) }), views: z.object({ nodes: z.array(z.object({ layout: z.string() })) }),
  }) }), `query($id:ID!){node(id:$id){... on ProjectV2{fields(first:30){nodes{${SELECT_FIELD}}} views(first:20){nodes{layout}}}}}`, { id: projectId }).node;
  const fields = node.fields.nodes.flatMap((f) => { const r = selectField.safeParse(f); return r.success ? [r.data] : []; });
  return { fields, hasBoard: node.views.nodes.some((v) => v.layout === "BOARD_LAYOUT") };
}

const sameOptions = (f: SelectField, opts: readonly Option[]): boolean =>
  f.options.map((o) => o.name).join("|") === opts.map((o) => o.name).join("|");

/** Status-fältet med tavlans kolumner (sätts om de skiljer sig; befintliga val ersätts). */
function ensureStatus(run: GhRunner, fields: SelectField[]): SelectField {
  const status = fields.find((f) => f.name === "Status");
  if (!status) throw new Error("projektet saknar Status-fältet");
  if (sameOptions(status, COLUMNS)) return status;
  return gql(run, z.object({ updateProjectV2Field: z.object({ projectV2Field: selectField }) }),
    `mutation($id:ID!){updateProjectV2Field(input:{fieldId:$id,singleSelectOptions:${literal(COLUMNS)}}){projectV2Field{${SELECT_FIELD}}}}`,
    { id: status.id }).updateProjectV2Field.projectV2Field;
}

function ensurePrio(run: GhRunner, projectId: string, fields: SelectField[]): SelectField {
  const prio = fields.find((f) => f.name === "Prio");
  if (prio) return prio;
  return gql(run, z.object({ createProjectV2Field: z.object({ projectV2Field: selectField }) }),
    `mutation($p:ID!){createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:"Prio",singleSelectOptions:${literal(PRIO_OPTIONS)}}){projectV2Field{${SELECT_FIELD}}}}`,
    { p: projectId }).createProjectV2Field.projectV2Field;
}

function ensureBoardView(run: GhRunner, projectId: string, hasBoard: boolean): void {
  if (hasBoard) return;
  gql(run, z.looseObject({}),
    "mutation($p:ID!){createProjectV2View(input:{projectId:$p,name:\"Tavla\",layout:BOARD_LAYOUT}){projectV2View{id}}}", { p: projectId });
}

const itemSchema = z.object({
  id: z.string(),
  content: z.object({ number: z.number().optional(), state: z.string().optional(), repository: z.object({ nameWithOwner: z.string() }).optional() }).nullable(),
  fieldValues: z.object({ nodes: z.array(z.object({ name: z.string().optional(), field: z.object({ name: z.string().optional() }).optional() })) }),
});
const page = z.object({ node: z.object({ items: z.object({
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }), nodes: z.array(itemSchema),
}) }) });
const ITEMS = "nodes{id content{... on Issue{number state repository{nameWithOwner}}} fieldValues(first:20){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}}}";

const valueOf = (i: z.infer<typeof itemSchema>, field: string): string | null =>
  i.fieldValues.nodes.find((v) => v.field?.name === field)?.name ?? null;

function readItems(run: GhRunner, projectId: string): BoardItem[] {
  const out: BoardItem[] = [];
  for (let after: string | null = null, more = true; more;) {
    const vars: Record<string, string> = after === null ? { id: projectId } : { id: projectId, after };
    const items = gql(run, page, `query($id:ID!,$after:String){node(id:$id){... on ProjectV2{items(first:100,after:$after){pageInfo{hasNextPage endCursor} ${ITEMS}}}}}`, vars).node.items;
    for (const i of items.nodes) {
      const c = i.content;
      if (c?.number === undefined || !c.repository) continue;
      out.push({ itemId: i.id, number: c.number, repo: c.repository.nameWithOwner, open: c.state === "OPEN", column: valueOf(i, "Status"), prio: valueOf(i, "Prio") });
    }
    more = items.pageInfo.hasNextPage;
    after = items.pageInfo.endCursor;
  }
  return out;
}

const optionId = (f: SelectField, name: string): string => {
  const o = f.options.find((x) => x.name === name);
  if (!o) throw new Error(`fältet ${f.name} saknar valet ${name}`);
  return o.id;
};

/** Tavlan: hittar eller skapar projektet och dess fält, och ger operationerna synken behöver. */
export function projectBoard(run: GhRunner, owner: string, title: string, log: (l: string) => void): BoardApi {
  const p = findOrCreateProject(run, owner, title, log);
  const { fields, hasBoard } = readFields(run, p.id);
  const status = ensureStatus(run, fields);
  const prio = ensurePrio(run, p.id, fields);
  ensureBoardView(run, p.id, hasBoard);
  const setOption = (itemId: string, f: SelectField, name: string): void => {
    gql(run, z.looseObject({}),
      "mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}",
      { p: p.id, i: itemId, f: f.id, o: optionId(f, name) });
  };
  return {
    url: p.url,
    items: () => readItems(run, p.id),
    add: (contentId) => gql(run, z.object({ addProjectV2ItemById: z.object({ item: z.object({ id: z.string() }) }) }),
      "mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}", { p: p.id, c: contentId }).addProjectV2ItemById.item.id,
    setColumn: (itemId, column) => setOption(itemId, status, column),
    setPrio: (itemId, value) => setOption(itemId, prio, value),
    archive: (itemId) => {
      gql(run, z.looseObject({}), "mutation($p:ID!,$i:ID!){archiveProjectV2Item(input:{projectId:$p,itemId:$i}){item{id}}}", { p: p.id, i: itemId });
    },
  };
}
