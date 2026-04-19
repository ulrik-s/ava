const MEILI_URL = process.env.MEILI_URL || "http://localhost:7700";
const MEILI_KEY = process.env.MEILI_MASTER_KEY || "";

const INDEX_NAME = "documents";

async function meiliRequest(path: string, options: RequestInit = {}) {
  const res = await fetch(`${MEILI_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MEILI_KEY}`,
      ...options.headers,
    },
  });
  return res;
}

/**
 * Ensure the documents index exists with proper searchable/filterable attributes.
 */
export async function ensureIndex() {
  // Create index if it doesn't exist
  await meiliRequest(`/indexes/${INDEX_NAME}`, {
    method: "PATCH",
    body: JSON.stringify({ primaryKey: "id" }),
  }).catch(() => null);

  await meiliRequest(`/indexes`, {
    method: "POST",
    body: JSON.stringify({ uid: INDEX_NAME, primaryKey: "id" }),
  }).catch(() => null);

  // Configure searchable and filterable attributes
  await meiliRequest(`/indexes/${INDEX_NAME}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      searchableAttributes: ["content", "fileName"],
      filterableAttributes: ["matterId", "organizationId"],
      displayedAttributes: ["id", "fileName", "matterId", "matterNumber", "matterTitle", "organizationId"],
    }),
  });
}

export interface DocumentIndex {
  id: string;
  fileName: string;
  content: string;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  organizationId: string;
}

/**
 * Add or update a document in the search index.
 */
export async function indexDocument(doc: DocumentIndex) {
  await ensureIndex();
  const res = await meiliRequest(`/indexes/${INDEX_NAME}/documents`, {
    method: "POST",
    body: JSON.stringify([doc]),
  });
  return res.json();
}

/**
 * Remove a document from the search index.
 */
export async function removeDocument(id: string) {
  await meiliRequest(`/indexes/${INDEX_NAME}/documents/${id}`, {
    method: "DELETE",
  });
}

export interface SearchResult {
  id: string;
  fileName: string;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  organizationId: string;
  _formatted?: {
    content?: string;
    fileName?: string;
  };
}

/**
 * Search documents by query string, scoped to an organization.
 */
export async function searchDocuments(
  query: string,
  organizationId: string,
  limit = 20
): Promise<{ hits: SearchResult[]; estimatedTotalHits: number }> {
  await ensureIndex();
  const res = await meiliRequest(`/indexes/${INDEX_NAME}/search`, {
    method: "POST",
    body: JSON.stringify({
      q: query,
      filter: `organizationId = "${organizationId}"`,
      limit,
      attributesToHighlight: ["content", "fileName"],
      highlightPreTag: "<mark>",
      highlightPostTag: "</mark>",
      attributesToCrop: ["content"],
      cropLength: 80,
    }),
  });

  if (!res.ok) {
    throw new Error(`Meilisearch search failed: ${res.status}`);
  }

  return res.json();
}
