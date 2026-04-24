import type { EnvironmentId, WeaveDispatchableCommand } from "@t3tools/contracts";
import { readEnvironmentConnection } from "../environments/runtime/service";

export async function dispatchWeaveCommand(
  environmentId: EnvironmentId,
  command: WeaveDispatchableCommand,
): Promise<{ sequence: number }> {
  const connection = readEnvironmentConnection(environmentId);
  if (!connection) throw new Error(`No connection for environment ${environmentId}`);
  return await connection.client.orchestration.dispatchCommand(command as never);
}
