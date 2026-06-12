// serverEntry `register(ctx)` — capability registration shape (cinatra#151
// Stage 4).
//
// Pins:
//   - the capability id set register(ctx) publishes (the email-sender-identities
//     surface joins email-send / chat-user-context / nango-connection-saved);
//   - the email-sender-identities impl: app discriminator + structured
//     identities read through the ctx-bound deps (host connector-config
//     service) — the host's HITL field-renderer loader consumes exactly this
//     shape instead of value-importing getStoredGmailSendAsAddresses;
//   - registration-only activation (no host-service call at register time —
//     probe safety: required/guarded activation must not perform I/O).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { register } from "../register";
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";

type Registered = Map<string, { packageName: string; impl: unknown }[]>;

function makeCtx(configRows: Record<string, unknown>) {
  const registered: Registered = new Map();
  const read = vi.fn((connectorId: string, fallback: unknown) => {
    return configRows[connectorId] ?? fallback;
  });
  const ctx = {
    capabilities: {
      registerProvider: (capability: string, provider: { packageName: string; impl: unknown }) => {
        const list = registered.get(capability) ?? [];
        list.push(provider);
        registered.set(capability, list);
      },
      resolveProviders: (capability: string) =>
        capability === "@cinatra-ai/host:connector-config"
          ? [{ packageName: "@cinatra-ai/host", impl: { read, write: vi.fn(), delete: vi.fn() } }]
          : [],
    },
    authSession: { getActor: vi.fn(async () => ({ userId: "u1" })) },
  } as unknown as ExtensionHostContext;
  return { ctx, registered, read };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("register(ctx) — capability shape", () => {
  it("registers the four capabilities and performs NO host-service I/O at activation", () => {
    const { ctx, registered, read } = makeCtx({});
    register(ctx);
    expect([...registered.keys()].sort()).toEqual([
      "chat-user-context",
      "email-send",
      "email-sender-identities",
      "nango-connection-saved",
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it("email-sender-identities: app discriminator + structured per-user identities from the synced store", () => {
    const { ctx, registered } = makeCtx({
      "gmail_user:u1": {
        sendAsAliases: [
          { email: "ada@example.com", displayName: "Ada" },
          { email: "ops@example.com" },
        ],
      },
    });
    register(ctx);
    const provider = registered.get("email-sender-identities")?.[0];
    expect(provider?.packageName).toBe("@cinatra-ai/gmail-connector");
    const impl = provider?.impl as {
      app: string;
      getSenderIdentities(input: { userId?: string }): { email: string; displayName?: string }[];
    };
    expect(impl.app).toBe("gmail");
    expect(impl.getSenderIdentities({ userId: "u1" })).toEqual([
      { email: "ada@example.com", displayName: "Ada" },
      { email: "ops@example.com" },
    ]);
  });

  it("email-sender-identities: empty store -> empty identities (no throw)", () => {
    const { ctx, registered } = makeCtx({});
    register(ctx);
    const impl = registered.get("email-sender-identities")?.[0]?.impl as {
      getSenderIdentities(input: { userId?: string }): unknown[];
    };
    expect(impl.getSenderIdentities({ userId: "u1" })).toEqual([]);
  });
});
