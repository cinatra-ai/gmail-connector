import { z } from "zod";
import type { ExtensionMcpToolServer, ExtensionMcpToolResult } from "@cinatra-ai/sdk-extensions";
import { createGmailPrimitiveHandlers, sendMessageSchema, findReplySchema } from "./handlers";

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

export function registerGmailPrimitives(server: ExtensionMcpToolServer) {
  const handlers = createGmailPrimitiveHandlers();

  for (const [name, handler] of Object.entries(handlers)) {
    const meta = TOOL_META[name] ?? { description: name, inputSchema: z.object({}).passthrough() };
    server.registerTool(
      name,
      {
        title: name,
        description: meta.description,
        inputSchema: meta.inputSchema,
      },
      async (input): Promise<ExtensionMcpToolResult> => {
        const result = await handler({
          primitiveName: name,
          input,
          actor: { actorType: "model", source: "agent" },
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
