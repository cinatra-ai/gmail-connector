import { z } from "zod";
import type { ExtensionPrimitiveRequest } from "@cinatra-ai/sdk-extensions";
import {
  getGmailConnectorStatus,
  getStoredGmailSendAsAddresses,
  refreshGmailSendAsAddresses,
  sendGmailMessage,
  findGmailReplyInThread,
} from "../index";

// The account a send / reply-lookup acts on is bound to the TRUSTED actor of
// the current invocation (the host builds `request.actor` server-side — from
// the agent-run owner on the passthrough path, or from the MCP request store
// on the native-relay path; see ./registry). It is NEVER taken from tool
// input, so an agent cannot name another user's id to act on that user's
// connected Gmail. `userId` is intentionally absent from these input schemas.
export const sendMessageSchema = z.object({
  to: z.array(z.string()),
  subject: z.string(),
  textBody: z.string(),
  fromEmail: z.string().optional(),
  fromName: z.string().optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  replyTo: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  providerThreadId: z.string().optional(),
});

export const findReplySchema = z.object({
  providerThreadId: z.string().optional(),
  recipientEmail: z.string(),
  sentAfter: z.string().optional(),
});

/**
 * Read the trusted user id from the host-built request actor. The actor is
 * server-controlled (never derived from tool input); a non-string / blank
 * value resolves to `undefined`, which routes to the app-scope Gmail
 * connection (the existing single-tenant behavior).
 */
function trustedUserIdFromActor(actor: unknown): string | undefined {
  if (actor && typeof actor === "object" && "userId" in actor) {
    const userId = (actor as { userId?: unknown }).userId;
    if (typeof userId === "string" && userId.trim().length > 0) return userId;
  }
  return undefined;
}

/**
 * Fail CLOSED if a caller smuggles a `userId` into tool input. Identity is
 * bound server-side to the trusted actor; a model-supplied `userId` is an
 * account-spoofing attempt (or a stale caller) and is rejected loudly rather
 * than silently ignored, so it surfaces instead of masquerading as success.
 */
function rejectModelSuppliedUserId(input: unknown, tool: string): void {
  if (
    input &&
    typeof input === "object" &&
    "userId" in input &&
    (input as { userId?: unknown }).userId !== undefined
  ) {
    throw new Error(
      `${tool}: 'userId' is not an accepted input. The Gmail account is bound to the ` +
        `authenticated session, not tool input.`,
    );
  }
}

export function createGmailPrimitiveHandlers() {
  return {
    "gmail_status": async (_request: ExtensionPrimitiveRequest<unknown>) => {
      return getGmailConnectorStatus();
    },

    "gmail_aliases_list": async (_request: ExtensionPrimitiveRequest<unknown>) => {
      return getStoredGmailSendAsAddresses();
    },

    "gmail_aliases_refresh": async (_request: ExtensionPrimitiveRequest<unknown>) => {
      return refreshGmailSendAsAddresses();
    },

    "gmail_email_send": async (request: ExtensionPrimitiveRequest<unknown>) => {
      rejectModelSuppliedUserId(request.input, "gmail_email_send");
      const message = sendMessageSchema.parse(request.input);
      const userId = trustedUserIdFromActor(request.actor);
      return sendGmailMessage(message, { userId });
    },

    "gmail_email_find_reply": async (request: ExtensionPrimitiveRequest<unknown>) => {
      rejectModelSuppliedUserId(request.input, "gmail_email_find_reply");
      const input = findReplySchema.parse(request.input);
      const userId = trustedUserIdFromActor(request.actor);
      return findGmailReplyInThread({ ...input, userId });
    },
  } as const;
}
