/**
 * Account-integrity guard for the Gmail MCP primitives.
 *
 * The `gmail_email_send` / `gmail_email_find_reply` primitives must bind the
 * acted-on Gmail account to the TRUSTED actor of the invocation (built
 * server-side by the host), NEVER to a model-supplied `userId`. Without this
 * binding an agent could send from / read replies in any user's connected
 * Gmail by naming that user's id in tool input.
 *
 * These tests exercise the real handlers + registry wrapper against a stubbed
 * host-deps slot, and assert that every authenticated Gmail API call is scoped
 * to the trusted id and that a smuggled `userId` is rejected fail-closed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  registerGmailConnector,
  _resetGmailDepsForTests,
  type GmailConnectorDeps,
} from "../deps";
import { createGmailPrimitiveHandlers, sendMessageSchema, findReplySchema } from "../mcp/handlers";
import { registerGmailPrimitives, type ConnectorActorResolver } from "../mcp/registry";

const refreshMock = vi.fn(async () => ({ accessToken: "t", accountEmail: "me@example.com" }));
const apiFetchMock = vi.fn(async (input: { url: string }) => {
  if (input.url.includes("/messages/send")) return { id: "msg-1", threadId: "th-1" };
  // metadata reads (getMessageInternetId / getMessageMetadata)
  return { payload: { headers: [{ name: "Message-ID", value: "<abc@mail>" }] } };
});
const searchFetchMock = vi.fn(async () => ({ messages: [] }));

function stubDeps(fetchImpl = apiFetchMock): GmailConnectorDeps {
  return {
    readConnectorConfigFromDatabase: vi.fn((_id: string, fallback: unknown) => fallback) as never,
    writeConnectorConfigToDatabase: vi.fn(),
    nango: {
      getPrimarySavedConnection: vi.fn(() => null),
      clearConnectionRecords: vi.fn(async () => undefined),
    },
    oauth: {
      getStatus: vi.fn(async () => ({ status: "not_connected" as const })),
      apiFetch: fetchImpl as never,
      refreshAccessTokenIfNeeded: refreshMock,
    },
    requireSessionUserId: vi.fn(async () => "should-not-be-used"),
  };
}

/** Every userId that reached the authenticated OAuth surface (refresh + apiFetch). */
function scopedUserIds(): Array<string | undefined> {
  const ids: Array<string | undefined> = [];
  for (const call of refreshMock.mock.calls) ids.push((call[0] as { userId?: string } | undefined)?.userId);
  for (const call of apiFetchMock.mock.calls) ids.push((call[1] as { userId?: string } | undefined)?.userId);
  for (const call of searchFetchMock.mock.calls) ids.push((call[1] as { userId?: string } | undefined)?.userId);
  return ids;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetGmailDepsForTests();
});

describe("gmail MCP primitives — identity is bound to the trusted actor, not input", () => {
  it("the input schemas do not expose a `userId` field", () => {
    expect(Object.keys(sendMessageSchema.shape)).not.toContain("userId");
    expect(Object.keys(findReplySchema.shape)).not.toContain("userId");
  });

  it("gmail_email_send scopes the Gmail API call to the trusted actor userId", async () => {
    registerGmailConnector(stubDeps());
    const handlers = createGmailPrimitiveHandlers();
    await handlers.gmail_email_send({
      primitiveName: "gmail_email_send",
      input: { to: ["dest@example.com"], subject: "s", textBody: "b" },
      actor: { actorType: "human", source: "a2a", userId: "trusted-user" },
      mode: "agentic",
    });
    const ids = scopedUserIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id === "trusted-user")).toBe(true);
  });

  it("gmail_email_send REJECTS a model-supplied userId fail-closed (no API call happens)", async () => {
    registerGmailConnector(stubDeps());
    const handlers = createGmailPrimitiveHandlers();
    await expect(
      handlers.gmail_email_send({
        primitiveName: "gmail_email_send",
        input: { to: ["dest@example.com"], subject: "s", textBody: "b", userId: "victim-user" },
        actor: { actorType: "human", source: "a2a", userId: "attacker-user" },
        mode: "agentic",
      }),
    ).rejects.toThrow(/userId.*not an accepted input/i);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("gmail_email_find_reply scopes the Gmail API call to the trusted actor userId", async () => {
    registerGmailConnector(stubDeps(searchFetchMock as never));
    const handlers = createGmailPrimitiveHandlers();
    await handlers.gmail_email_find_reply({
      primitiveName: "gmail_email_find_reply",
      input: { recipientEmail: "dest@example.com" },
      actor: { actorType: "human", source: "a2a", userId: "trusted-user" },
      mode: "agentic",
    });
    expect(scopedUserIds().every((id) => id === "trusted-user")).toBe(true);
  });

  it("gmail_email_find_reply REJECTS a model-supplied userId fail-closed", async () => {
    registerGmailConnector(stubDeps(searchFetchMock as never));
    const handlers = createGmailPrimitiveHandlers();
    await expect(
      handlers.gmail_email_find_reply({
        primitiveName: "gmail_email_find_reply",
        input: { recipientEmail: "dest@example.com", userId: "victim-user" },
        actor: { actorType: "human", source: "a2a", userId: "attacker-user" },
        mode: "agentic",
      }),
    ).rejects.toThrow(/userId.*not an accepted input/i);
    expect(searchFetchMock).not.toHaveBeenCalled();
  });

  it("no trusted userId → app-scope (undefined), never a fallback to input", async () => {
    registerGmailConnector(stubDeps());
    const handlers = createGmailPrimitiveHandlers();
    await handlers.gmail_email_send({
      primitiveName: "gmail_email_send",
      input: { to: ["dest@example.com"], subject: "s", textBody: "b" },
      actor: { actorType: "model", source: "agent" },
      mode: "agentic",
    });
    expect(scopedUserIds().every((id) => id === undefined)).toBe(true);
  });
});

describe("registerGmailPrimitives — the registry builds the actor server-side from resolveActor", () => {
  type Registered = { name: string; handler: (input: unknown, extra?: unknown) => Promise<unknown> };

  function registerOnStubServer(resolveActor?: ConnectorActorResolver): Map<string, Registered["handler"]> {
    const tools = new Map<string, Registered["handler"]>();
    const server = {
      registerTool: (name: string, _config: unknown, handler: Registered["handler"]) => {
        tools.set(name, handler);
      },
    };
    registerGmailPrimitives(server as never, resolveActor);
    return tools;
  }

  it("stamps the resolveActor()-resolved userId onto the actor the handler sees", async () => {
    registerGmailConnector(stubDeps());
    const tools = registerOnStubServer(async () => ({ userId: "resolved-user", orgId: "org-1" }));
    // A hostile input carrying its own `userId` / `actor` must not influence scoping.
    await tools.get("gmail_email_send")!({
      to: ["dest@example.com"],
      subject: "s",
      textBody: "b",
      actor: { userId: "spoofed-actor" },
    });
    expect(scopedUserIds().every((id) => id === "resolved-user")).toBe(true);
  });

  it("absent resolver → app-scope (undefined userId)", async () => {
    registerGmailConnector(stubDeps());
    const tools = registerOnStubServer(undefined);
    await tools.get("gmail_email_send")!({ to: ["dest@example.com"], subject: "s", textBody: "b" });
    expect(scopedUserIds().every((id) => id === undefined)).toBe(true);
  });
});
