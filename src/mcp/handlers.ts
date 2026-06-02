import { z } from "zod";
import type { ExtensionPrimitiveRequest } from "@cinatra-ai/sdk-extensions";
import {
  getGmailConnectorStatus,
  getStoredGmailSendAsAddresses,
  refreshGmailSendAsAddresses,
  sendGmailMessage,
  findGmailReplyInThread,
} from "../index";

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
  userId: z.string().optional(),
});

export const findReplySchema = z.object({
  providerThreadId: z.string().optional(),
  recipientEmail: z.string(),
  sentAfter: z.string().optional(),
  userId: z.string().optional(),
});

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
      const input = sendMessageSchema.parse(request.input);
      const { userId, ...message } = input;
      return sendGmailMessage(message, { userId });
    },

    "gmail_email_find_reply": async (request: ExtensionPrimitiveRequest<unknown>) => {
      const input = findReplySchema.parse(request.input);
      return findGmailReplyInThread(input);
    },
  } as const;
}
