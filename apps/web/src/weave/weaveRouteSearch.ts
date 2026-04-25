import type { WeaveNodeId } from "@t3tools/contracts";

// v0.1 search params for the weave run view. `node` carries the inspector
// open-node id so it can be set/cleared without changing path params.

export interface WeaveRouteSearch {
  readonly node?: WeaveNodeId;
}

export function parseWeaveRouteSearch(search: Record<string, unknown>): WeaveRouteSearch {
  const node = search.node;
  if (typeof node === "string" && node.length > 0) {
    return { node: node as WeaveNodeId };
  }
  return {};
}
