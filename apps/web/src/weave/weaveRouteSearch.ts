// v0.1 search params for the weave run view. Inspector-open-to-node-id is carried in the nested
// /node/$nodeId route, not in search — but keep a `tab` param reserved for future drill-downs.
// Currently empty; reserved for future drill-down params.

export interface WeaveRouteSearch {}

export function parseWeaveRouteSearch(_search: Record<string, unknown>): WeaveRouteSearch {
  return {};
}
