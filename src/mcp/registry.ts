import { z } from "zod";
import type { ExtensionMcpToolServer, ExtensionMcpToolResult } from "@cinatra-ai/sdk-extensions";
import { createGmailPrimitiveHandlers, sendMessageSchema, findReplySchema } from "./handlers";

/**
 * Host-provided resolver for the TRUSTED human subject of the current MCP
 * request (userId/orgId), derived from the request/run context — the MCP SDK
 * transport carries no actor on `registerTool`'s handler args. Structural
 * (matches the host's uniform connector-module option) so the connector stays
 * SDK-only. When present, the registry stamps the resolved identity onto the
 * actor the primitive handler sees; the handler binds the acted-on Gmail
 * account to it, never to tool input.
 */
export type ConnectorActorResolver = () => Promise<{ userId?: string; orgId?: string }>;

const TOOL_META: Record<string, { description: string; inputSchema: z.ZodTypeAny }> = {
  "gmail_status": {
    description: "Get the current Gmail connector connection status.",
    inputSchema: z.object({}),
  },
  "gmail_aliases_list": {
    description: "List all stored Gmail send-as aliases (configured sender addresses).",
    inputSchema: z.object({}),
  },
  "gmail_aliases_refresh": {
    description: "Refresh the list of Gmail send-as aliases from the Gmail API.",
    inputSchema: z.object({}),
  },
  "gmail_email_send": {
    description: "Send an email via the Gmail API.",
    inputSchema: sendMessageSchema,
  },
  "gmail_email_find_reply": {
    description: "Find a reply to a sent email in a Gmail thread.",
    inputSchema: findReplySchema,
  },
};

// cinatra#3745: `gmail_email_send` sends a message on a person's behalf, so its
// registration declares `outward`: the host holds each call of it during an
// agent run for the person's recorded decision. It takes free text and no
// stored item, so it names no subject. No other tool here acts outward. A
// declaration only adds a hold; it never authorizes a call. A host that does
// not read the field ignores it. Spread from a constant so an SDK config type
// without the field still accepts it.
const OUTWARD_TOOL_NAMES = new Set(["gmail_email_send"]);
const OUTWARD = { outward: {} };

export function registerGmailPrimitives(
  server: ExtensionMcpToolServer,
  resolveActor?: ConnectorActorResolver,
) {
  const handlers = createGmailPrimitiveHandlers();

  for (const [name, handler] of Object.entries(handlers)) {
    const meta = TOOL_META[name] ?? { description: name, inputSchema: z.object({}).passthrough() };
    server.registerTool(
      name,
      {
        title: name,
        description: meta.description,
        inputSchema: meta.inputSchema,
        ...(OUTWARD_TOOL_NAMES.has(name) ? OUTWARD : {}),
      },
      async (input): Promise<ExtensionMcpToolResult> => {
        // Build the actor SERVER-SIDE from the host-provided resolver; never
        // trust an inbound/model-supplied actor. Absent resolver → no userId →
        // app-scope Gmail (the existing single-tenant behavior).
        const resolved = resolveActor ? await resolveActor() : {};
        const result = await handler({
          primitiveName: name,
          input,
          actor: {
            actorType: "model",
            source: "agent",
            userId: resolved.userId,
            orgId: resolved.orgId,
          },
          mode: "agentic",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: Array.isArray(result) ? { items: result } : typeof result === "object" && result !== null ? (result as Record<string, unknown>) : { result },
        };
      },
    );
  }
}
