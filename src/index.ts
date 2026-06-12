import type { EmailConnectorDefinition } from "@cinatra-ai/sdk-extensions";
// Host-coupled runtime surfaces (`@/lib/database` connector-config, Google
// OAuth, Nango connection storage) are resolved through injected deps via
// getGmailDeps(). Boot wires concrete impls via registerGmailConnector(deps)
// in src/lib/register-transport-connectors.ts so this connector carries NO
// non-SDK `@cinatra-ai/*` code dependency (SDK-only decouple).
import { getGmailDeps } from "./deps";
// Generic email types live in `@cinatra-ai/sdk-extensions/email-contract`, the
// provider-neutral contract package.
import type { EmailReplyMatch, EmailSendReceipt, EmailSystemMessage } from "@cinatra-ai/sdk-extensions/email-contract";

type GmailConnectorSettings = {
  sendAsAddresses?: string[];
  sendAsAliases?: Array<{
    email: string;
    displayName?: string;
  }>;
  sendAsSyncedAt?: string;
};

function getSettingsConnectorId(userId?: string) {
  return userId ? `gmail_user:${userId}` : "gmail";
}

export type GmailSendAsAlias = {
  email: string;
  displayName?: string;
};

// gmailAPIConnector lives in ./definition.ts to break the index.ts <->
// email-connector.ts circular-dep TDZ at server boot. Re-exported here so the
// existing public surface
// (consumers importing from @cinatra-ai/gmail-connector) is unchanged.
export { gmailAPIConnector } from "./definition";

function readSettings(userId?: string) {
  const deps = getGmailDeps();
  const connectorId = getSettingsConnectorId(userId);
  const current = deps.readConnectorConfigFromDatabase<GmailConnectorSettings>(connectorId, {});
  const legacy = deps.readConnectorConfigFromDatabase<{
    sendAsAddresses?: string[];
    sendAsSyncedAt?: string;
  }>(connectorId, {});
  return {
    sendAsAddresses: current.sendAsAddresses ?? legacy.sendAsAddresses,
    sendAsAliases: current.sendAsAliases ?? [],
    sendAsSyncedAt: current.sendAsSyncedAt ?? legacy.sendAsSyncedAt,
  };
}

function writeSettings(value: GmailConnectorSettings, userId?: string) {
  const deps = getGmailDeps();
  deps.writeConnectorConfigToDatabase(getSettingsConnectorId(userId), value);
}

function parseEmailAddress(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(/<([^>]+)>/);
  return (match?.[1] ?? normalized).trim().toLowerCase();
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/\r?\n|\r/g, " ").trim();
}

function encodeMimeHeader(value: string) {
  const sanitized = sanitizeHeaderValue(value);
  if (!sanitized) {
    return "";
  }
  if (/^[\x20-\x7E]*$/.test(sanitized)) {
    return sanitized;
  }
  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
}

function formatMailboxHeader(displayName: string | undefined, email: string) {
  const normalizedEmail = sanitizeHeaderValue(email);
  const normalizedDisplayName = sanitizeHeaderValue(String(displayName ?? ""));
  if (!normalizedDisplayName) {
    return normalizedEmail;
  }
  return `${encodeMimeHeader(normalizedDisplayName)} <${normalizedEmail}>`;
}

async function gmailFetch<T>(input: {
  pathname: string;
  method?: string;
  body?: unknown;
  userId?: string;
}) {
  return getGmailDeps().oauth.apiFetch<T>({
    url: `https://gmail.googleapis.com/gmail/v1/users/me${input.pathname}`,
    method: input.method,
    body: input.body,
  }, input.userId ? { userId: input.userId, connectorKey: "gmail" } : undefined);
}

async function getMessageInternetId(messageId: string, userId?: string) {
  const payload = await gmailFetch<{
    payload?: {
      headers?: Array<{ name?: string; value?: string }>;
    };
  }>({
    pathname: `/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Message-ID`,
    userId,
  });
  return payload.payload?.headers?.find((header) => String(header.name ?? "").toLowerCase() === "message-id")?.value;
}

async function getMessageMetadata(messageId: string, userId?: string) {
  return gmailFetch<{
    id?: string;
    threadId?: string;
    internalDate?: string;
    snippet?: string;
    payload?: {
      headers?: Array<{ name?: string; value?: string }>;
    };
  }>({
    pathname: `/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`,
    userId,
  });
}

async function listGmailSendAsAliases() {
  return gmailFetch<{
    sendAs?: Array<{
      sendAsEmail?: string;
      displayName?: string;
      isPrimary?: boolean;
      isDefault?: boolean;
      verificationStatus?: string;
      treatAsAlias?: boolean;
    }>;
  }>({
    pathname: "/configuration/sendAs",
  });
}

async function listGmailSendAsAliasesForUser(userId: string) {
  return gmailFetch<{
    sendAs?: Array<{
      sendAsEmail?: string;
      displayName?: string;
      isPrimary?: boolean;
      isDefault?: boolean;
      verificationStatus?: string;
      treatAsAlias?: boolean;
    }>;
  }>({
    pathname: "/configuration/sendAs",
    userId,
  });
}

function normalizeSendAsAddresses(aliases: Array<{ sendAsEmail?: string }> | undefined) {
  return [...new Set((aliases ?? []).map((alias) => String(alias.sendAsEmail ?? "").trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function normalizeSendAsAliases(
  aliases: Array<{ sendAsEmail?: string; displayName?: string }> | undefined,
) : GmailSendAsAlias[] {
  return (aliases ?? [])
    .flatMap((alias) => {
      const email = String(alias.sendAsEmail ?? "").trim();
      if (!email) {
        return [];
      }
      return [
        {
          email,
          displayName: String(alias.displayName ?? "").trim() || undefined,
        },
      ];
    })
    .sort((left, right) => left.email.localeCompare(right.email));
}

async function resolveGmailFromEmail(requestedFromEmail?: string, userId?: string) {
  const oauthSettings = await getGmailDeps().oauth.refreshAccessTokenIfNeeded(
    userId ? { userId, connectorKey: "gmail" } : undefined,
  );
  const connectedAccountEmail = parseEmailAddress(oauthSettings.accountEmail);
  const normalizedRequestedFromEmail = parseEmailAddress(requestedFromEmail);

  if (!normalizedRequestedFromEmail || normalizedRequestedFromEmail === connectedAccountEmail) {
    return oauthSettings.accountEmail ?? requestedFromEmail ?? "";
  }

  let aliases;
  try {
    aliases = userId ? await listGmailSendAsAliasesForUser(userId) : await listGmailSendAsAliases();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Gmail send-as aliases.";
    throw new Error(
      `${message} Reconnect the Google account so Cinatra has permission to verify Gmail send-as aliases for the sender email.`,
    );
  }

  const matchingAlias = (aliases.sendAs ?? []).find(
    (alias) => parseEmailAddress(alias.sendAsEmail) === normalizedRequestedFromEmail,
  );

  if (!matchingAlias) {
    throw new Error(
      `The connected Gmail account cannot send as ${requestedFromEmail}. Add that address as a Gmail send-as alias first, then reconnect the Google account if needed.`,
    );
  }

  if (String(matchingAlias.verificationStatus ?? "").toLowerCase() !== "accepted") {
    throw new Error(
      `The Gmail send-as alias ${requestedFromEmail} is not verified yet. Verify it in Gmail administration before sending campaign emails.`,
    );
  }

  return matchingAlias.sendAsEmail ?? requestedFromEmail;
}

export async function getGmailConnectorStatus(userId?: string) {
  const deps = getGmailDeps();
  if (userId) {
    const savedConnection =
      deps.nango.getPrimarySavedConnection("gmail", {
        scope: "user",
        userId,
      }) ??
      deps.nango.getPrimarySavedConnection("googleOAuth", {
        scope: "user",
        userId,
      });

    if (savedConnection) {
      return {
        status: "connected" as const,
        accountEmail: savedConnection.email,
        detail: `Connected${savedConnection.displayName ? ` as ${savedConnection.displayName}` : ""}.`,
      };
    }

    return {
      status: "not_connected" as const,
      accountEmail: undefined,
      detail: "Connect your Gmail account through Nango to send and monitor campaign emails.",
    };
  }

  return deps.oauth.getStatus();
}

export function getStoredGmailSendAsAddresses(userId?: string) {
  const settings = readSettings(userId);
  const aliases: GmailSendAsAlias[] =
    settings.sendAsAliases && settings.sendAsAliases.length > 0
      ? settings.sendAsAliases
      : (settings.sendAsAddresses ?? []).map((email) => ({ email }));
  return {
    addresses: settings.sendAsAddresses ?? [],
    aliases,
    syncedAt: settings.sendAsSyncedAt,
  };
}

// Chat user-context provider record for the host's generic capability
// registry (capability id "chat-user-context"). The CONNECTOR owns the
// section formatting; the chat runner just appends whatever the live
// providers return — it no longer imports this package by name. Registered
// at serverEntry activation (`register.ts`) and, transitionally, by the
// host's boot bridge; both registrations carry this record's packageName, so
// the registry idempotently dedupes. Structurally typed on purpose (no SDK
// type import needed — the host SDK contract is additive and lands with the
// host-side consumer): `{ packageName, impl: { buildSections } }`.
// `buildSections` is cheap + local by contract: it reads the already-synced
// send-as store; no network.
export const gmailChatUserContextProvider = {
  packageName: "@cinatra-ai/gmail-connector",
  impl: {
    buildSections({ userId }: { userId?: string }): string[] {
      const { aliases } = getStoredGmailSendAsAddresses(userId);
      if (aliases.length === 0) return [];
      const list = aliases
        .map((a) => (a.displayName ? `${a.displayName} <${a.email}>` : a.email))
        .join(", ");
      return [`Gmail send-as addresses: ${list}`];
    },
  },
};

// Email-sender-identities provider record (capability id
// "email-sender-identities", cinatra#151 Stage 4): the STRUCTURED counterpart
// of the chat-user-context contribution above. The host's HITL
// field-renderer-context loader (packages/agents server action) resolves the
// live providers and aggregates per-app sender identities instead of
// value-importing this package's `getStoredGmailSendAsAddresses`. The `app`
// discriminator is the provider-agnostic app slug ("gmail" — NOT a package
// name); `getSenderIdentities` is cheap + local by contract (reads the
// already-synced send-as store; no network). Structurally typed on purpose
// (no SDK type import needed — the host SDK contract is additive and lands
// with the host-side consumer).
export const gmailSenderIdentitiesProvider = {
  packageName: "@cinatra-ai/gmail-connector",
  impl: {
    app: "gmail",
    getSenderIdentities({ userId }: { userId?: string }): GmailSendAsAlias[] {
      const { aliases } = getStoredGmailSendAsAddresses(userId);
      return aliases.map((a) =>
        a.displayName ? { email: a.email, displayName: a.displayName } : { email: a.email },
      );
    },
  },
};

export async function clearStoredGmailSendAsAddresses() {
  writeSettings({});
}

export async function clearStoredUserGmailSendAsAddresses(userId: string) {
  writeSettings({}, userId);
}

export async function refreshGmailSendAsAddresses() {
  const aliases = await listGmailSendAsAliases();
  const addresses = normalizeSendAsAddresses(aliases.sendAs);
  const normalizedAliases = normalizeSendAsAliases(aliases.sendAs);
  writeSettings({
    sendAsAddresses: addresses,
    sendAsAliases: normalizedAliases,
    sendAsSyncedAt: new Date().toISOString(),
  });
  return normalizedAliases;
}

export async function refreshUserGmailSendAsAddresses(userId: string) {
  const aliases = await listGmailSendAsAliasesForUser(userId);
  const addresses = normalizeSendAsAddresses(aliases.sendAs);
  const normalizedAliases = normalizeSendAsAliases(aliases.sendAs);
  writeSettings(
    {
      sendAsAddresses: addresses,
      sendAsAliases: normalizedAliases,
      sendAsSyncedAt: new Date().toISOString(),
    },
    userId,
  );
  return normalizedAliases;
}

// Connector-level dev-mode redirect chokepoint.
// Reads the email-system-development connector config (same key written by
// src/lib/email-system.ts saveEmailSystemDevelopmentSettings) and rewrites
// to/cc/bcc to the override recipient when developmentModeEnabled is true.
// Applied INSIDE sendGmailMessage so every caller path — direct, MCP via
// gmail_email_send, or via sendEmailThroughSystem — gets the same protection.
function applyDevelopmentRecipientOverride(message: EmailSystemMessage): EmailSystemMessage {
  const deps = getGmailDeps();
  const settings = deps.readConnectorConfigFromDatabase<{
    developmentModeEnabled?: boolean;
    overrideRecipientEmail?: string;
  }>("email-system-development", {});
  if (settings.developmentModeEnabled !== true) return message;
  const override = String(settings.overrideRecipientEmail ?? "").trim();
  if (!override) {
    throw new Error("Development mode is enabled, but no override recipient email is configured.");
  }
  return { ...message, to: [override], cc: [], bcc: [] };
}

export async function sendGmailMessage(rawMessage: EmailSystemMessage, options?: { userId?: string }): Promise<EmailSendReceipt> {
  const message = applyDevelopmentRecipientOverride(rawMessage);
  await getGmailDeps().oauth.refreshAccessTokenIfNeeded(options?.userId ? { userId: options.userId, connectorKey: "gmail" } : undefined);
  const fromEmail = await resolveGmailFromEmail(message.fromEmail, options?.userId);
  if (!fromEmail) {
    throw new Error("No Gmail sender account is connected.");
  }

  const lines = [
    `From: ${formatMailboxHeader(message.fromName, fromEmail)}`,
    `To: ${message.to.map((recipient) => sanitizeHeaderValue(recipient)).join(", ")}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.map((recipient) => sanitizeHeaderValue(recipient)).join(", ")}`] : []),
    ...(message.bcc?.length ? [`Bcc: ${message.bcc.map((recipient) => sanitizeHeaderValue(recipient)).join(", ")}`] : []),
    ...(message.replyTo ? [`Reply-To: ${sanitizeHeaderValue(message.replyTo)}`] : []),
    `Subject: ${encodeMimeHeader(message.subject)}`,
    ...(message.inReplyTo ? [`In-Reply-To: ${sanitizeHeaderValue(message.inReplyTo)}`] : []),
    ...(message.references?.length ? [`References: ${message.references.map((value) => sanitizeHeaderValue(value)).join(" ")}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    message.textBody,
  ];

  const payload = await gmailFetch<{ id?: string; threadId?: string }>({
    pathname: "/messages/send",
    method: "POST",
    body: {
      raw: base64UrlEncode(lines.join("\r\n")),
      ...(message.providerThreadId ? { threadId: message.providerThreadId } : {}),
    },
    userId: options?.userId,
  });

  if (!payload.id) {
    throw new Error("Gmail did not return a sent message id.");
  }

  return {
    providerId: "gmail",
    providerMessageId: payload.id,
    providerThreadId: payload.threadId,
    internetMessageId: await getMessageInternetId(payload.id, options?.userId),
    sentAt: new Date().toISOString(),
  };
}

export async function findGmailReplyInThread(input: {
  providerThreadId?: string;
  recipientEmail: string;
  sentAfter?: string;
  userId?: string;
}): Promise<EmailReplyMatch | null> {
  const oauthSettings = await getGmailDeps().oauth.refreshAccessTokenIfNeeded(
    input.userId ? { userId: input.userId, connectorKey: "gmail" } : undefined,
  );
  const senderEmail = parseEmailAddress(oauthSettings.accountEmail);
  const recipientEmail = parseEmailAddress(input.recipientEmail);
  const sentAfterTime = input.sentAfter ? new Date(input.sentAfter).getTime() : 0;
  if (input.providerThreadId) {
    const payload = await gmailFetch<{
      messages?: Array<{
        id?: string;
        threadId?: string;
        internalDate?: string;
      }>;
    }>({
      pathname: `/threads/${encodeURIComponent(input.providerThreadId)}?format=minimal`,
      userId: input.userId,
    });

    for (const message of payload.messages ?? []) {
      const internalDate = Number(message.internalDate ?? 0);
      if (!message.id || internalDate < sentAfterTime) {
        continue;
      }
      const metadata = await getMessageMetadata(message.id, input.userId);
      const fromHeader = metadata.payload?.headers?.find((header) => String(header.name ?? "").toLowerCase() === "from")?.value;
      const subjectHeader = metadata.payload?.headers?.find((header) => String(header.name ?? "").toLowerCase() === "subject")?.value;
      const fromEmail = parseEmailAddress(fromHeader);
      if (!fromEmail || fromEmail === senderEmail || fromEmail !== recipientEmail) {
        continue;
      }
      return {
        providerId: "gmail",
        providerMessageId: metadata.id ?? message.id,
        providerThreadId: metadata.threadId ?? message.threadId ?? input.providerThreadId,
        internetMessageId:
          metadata.payload?.headers?.find((header) => String(header.name ?? "").toLowerCase() === "message-id")?.value,
        subject: subjectHeader ?? "(no subject)",
        fromEmail,
        snippet: metadata.snippet,
        receivedAt: internalDate ? new Date(internalDate).toISOString() : new Date().toISOString(),
      };
    }
  }

  const queryParts = [`from:${recipientEmail}`];
  if (senderEmail) {
    queryParts.push(`to:${senderEmail}`);
  }
  if (input.sentAfter) {
    queryParts.push(`after:${Math.floor(new Date(input.sentAfter).getTime() / 1000)}`);
  }
  const payload = await gmailFetch<{
    messages?: Array<{ id?: string; threadId?: string }>;
  }>({
    pathname: `/messages?q=${encodeURIComponent(queryParts.join(" "))}&maxResults=10`,
    userId: input.userId,
  });

  for (const message of payload.messages ?? []) {
    if (!message.id) {
      continue;
    }
    const metadata = await getMessageMetadata(message.id, input.userId);
    const fromHeader = metadata.payload?.headers?.find((header) => String(header.name ?? "").toLowerCase() === "from")?.value;
    const subjectHeader = metadata.payload?.headers?.find((header) => String(header.name ?? "").toLowerCase() === "subject")?.value;
    const fromEmail = parseEmailAddress(fromHeader);
    if (!fromEmail || fromEmail === senderEmail || fromEmail !== recipientEmail) {
      continue;
    }
    const internalDate = Number(metadata.internalDate ?? 0);
    if (internalDate && internalDate < sentAfterTime) {
      continue;
    }
    return {
      providerId: "gmail",
      providerMessageId: metadata.id ?? message.id,
      providerThreadId: metadata.threadId ?? message.threadId,
      internetMessageId:
        metadata.payload?.headers?.find((header) => String(header.name ?? "").toLowerCase() === "message-id")?.value,
      subject: subjectHeader ?? "(no subject)",
      fromEmail,
      snippet: metadata.snippet,
      receivedAt: internalDate ? new Date(internalDate).toISOString() : new Date().toISOString(),
    };
  }

  return null;
}

// DI host-coupling escape.
// Host wires concrete impls of database/nango at boot via
// `registerGmailConnector(...)` from `src/lib/register-transport-connectors.ts`.
export { registerGmailConnector } from "./deps";
export type { GmailConnectorDeps } from "./deps";

// EmailConnector singleton conforming to the provider-neutral contract from
// `@cinatra-ai/email-connector`. Host registers this via
// registerEmailConnector(gmailEmailConnector) at boot.
export { gmailEmailConnector } from "./email-connector";
