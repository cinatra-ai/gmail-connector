import "server-only";

// ---------------------------------------------------------------------------
// @cinatra-ai/gmail-connector — EmailConnector singleton.
//
// Wraps the existing gmail transport functions in the provider-neutral
// `EmailConnector` shape from `@cinatra-ai/sdk-extensions/email-contract`. The
// facade registers this singleton at boot via
// `registerEmailConnector(gmailEmailConnector)`.
//
// The dev-mode override is NO LONGER applied here — that responsibility
// moved up to the facade in the email-connector facade. Each
// provider just sends what it's given.
// ---------------------------------------------------------------------------

import type {
  EmailConnector,
  EmailConnectorStatusResult,
  EmailReplyMatch,
  EmailSendReceipt,
  EmailSystemMessage,
} from "@cinatra-ai/sdk-extensions/email-contract";

// gmailAPIConnector is imported from the leaf definition file (NOT ./index)
// to avoid the TDZ cycle that fired at server boot. The other functions still
// come from ./index (no cycle: they're defined directly in index.ts and don't
// import from this file).
import { gmailAPIConnector } from "./definition";
import {
  findGmailReplyInThread,
  getGmailConnectorStatus,
  sendGmailMessage,
} from "./index";

async function send(
  msg: EmailSystemMessage,
  opts?: { userId?: string },
): Promise<EmailSendReceipt> {
  return sendGmailMessage(msg, { userId: opts?.userId });
}

async function findReply(opts: {
  providerThreadId?: string;
  recipientEmail: string;
  sentAfter?: string;
  userId?: string;
}): Promise<EmailReplyMatch | null> {
  return findGmailReplyInThread(opts);
}

async function getStatus(opts?: {
  userId?: string;
}): Promise<EmailConnectorStatusResult> {
  return getGmailConnectorStatus(opts?.userId);
}

export const gmailEmailConnector: EmailConnector = {
  definition: gmailAPIConnector,
  send,
  findReply,
  getStatus,
};
