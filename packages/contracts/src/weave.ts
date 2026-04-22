import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

// Branded IDs — mirror the `makeEntityId` pattern in baseSchemas.ts
// (trimmed non-empty strings with a nominal brand).
export const WeaveRunId = TrimmedNonEmptyString.pipe(Schema.brand("WeaveRunId"));
export type WeaveRunId = typeof WeaveRunId.Type;

export const WeaveNodeId = TrimmedNonEmptyString.pipe(Schema.brand("WeaveNodeId"));
export type WeaveNodeId = typeof WeaveNodeId.Type;

export const WeaveContractId = TrimmedNonEmptyString.pipe(Schema.brand("WeaveContractId"));
export type WeaveContractId = typeof WeaveContractId.Type;

export const WeavePhaseId = TrimmedNonEmptyString.pipe(Schema.brand("WeavePhaseId"));
export type WeavePhaseId = typeof WeavePhaseId.Type;

export const WeaveDecisionId = TrimmedNonEmptyString.pipe(Schema.brand("WeaveDecisionId"));
export type WeaveDecisionId = typeof WeaveDecisionId.Type;

// BlueprintVersion is a non-negative integer, branded for clarity at call sites.
export const BlueprintVersion = NonNegativeInt.pipe(Schema.brand("BlueprintVersion"));
export type BlueprintVersion = typeof BlueprintVersion.Type;
