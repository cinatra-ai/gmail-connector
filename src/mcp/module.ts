import { registerGmailPrimitives, type ConnectorActorResolver } from "./registry";
import type { ExtensionMcpToolServer } from "@cinatra-ai/sdk-extensions";

/**
 * @param options.resolveActor Host-provided resolver for the trusted request
 *   subject (userId/orgId). The host passes this uniformly to every connector
 *   module factory; the Gmail primitives bind the acted-on account to the
 *   resolved identity, never to tool input. A factory called without options
 *   (e.g. the in-process primitive-handlers capture) still registers — those
 *   handlers receive the trusted actor directly on `request.actor`.
 */
export function createGmailModule(options?: { resolveActor?: ConnectorActorResolver }) {
  return {
    registerCapabilities: (server: ExtensionMcpToolServer) =>
      registerGmailPrimitives(server, options?.resolveActor),
  };
}
