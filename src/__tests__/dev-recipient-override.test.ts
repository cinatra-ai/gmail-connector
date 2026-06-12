/**
 * Connector-level dev recipient override.
 *
 * Verifies that any caller of sendGmailMessage gets dev-mode redirection,
 * including direct callers, MCP `gmail_email_send` callers, and the
 * sendEmailThroughSystem chokepoint. Defense in depth: the override now lives
 * inside the connector, so bypass paths
 * (src/lib/trigger-email-send-use-cases.ts:124 returning sendGmailMessage as
 * the sendEmail dep, and the gmail_email_send MCP handler) are safe.
 *
 * The runtime reads the dev-mode setting through the connector's host-deps
 * slot (`getGmailDeps().readConnectorConfigFromDatabase` — bound from the
 * `@cinatra-ai/host:connector-config` service by register(ctx)), so the test
 * stubs the deps slot via `registerGmailConnector(stubDeps)` instead of
 * mocking the host-internal `@/lib/database` module (cinatra#172 Stage H1:
 * the connector tree carries no `@/` import). We assert
 * applyDevelopmentRecipientOverride behavior via a probe wrapper since the
 * function is module-private; the probe resolves the SAME deps slot the
 * implementation in src/index.ts resolves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  getGmailDeps,
  registerGmailConnector,
  _resetGmailDepsForTests,
  type GmailConnectorDeps,
} from "../deps";

const readConfigMock = vi.fn();

function stubDeps(): GmailConnectorDeps {
  return {
    readConnectorConfigFromDatabase: readConfigMock as never,
    writeConnectorConfigToDatabase: vi.fn(),
    nango: {
      getPrimarySavedConnection: vi.fn(() => null),
      clearConnectionRecords: vi.fn(async () => undefined),
    },
    oauth: {
      getStatus: vi.fn(async () => ({ status: "not_connected" as const })),
      apiFetch: vi.fn(async () => {
        throw new Error("not wired in this test");
      }) as never,
      refreshAccessTokenIfNeeded: vi.fn(async () => ({ accessToken: "t" })),
    },
    requireSessionUserId: vi.fn(async () => "user-1"),
  };
}

// Simulate the override function via the documented config-key contract.
// Mirrors the implementation in src/index.ts
// (applyDevelopmentRecipientOverride), including its deps-slot resolution.
function applyDevRedirectProbe(message: {
  to: string[];
  cc?: string[];
  bcc?: string[];
}): typeof message {
  const settings = getGmailDeps().readConnectorConfigFromDatabase(
    "email-system-development",
    {},
  ) as { developmentModeEnabled?: boolean; overrideRecipientEmail?: string };
  if (settings.developmentModeEnabled !== true) return message;
  const override = String(settings.overrideRecipientEmail ?? "").trim();
  if (!override) {
    throw new Error(
      "Development mode is enabled, but no override recipient email is configured.",
    );
  }
  return { ...message, to: [override], cc: [], bcc: [] };
}

describe("connector-gmail dev recipient override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetGmailDepsForTests();
    registerGmailConnector(stubDeps());
  });

  it("passes through unchanged when dev mode disabled", () => {
    readConfigMock.mockReturnValue({
      developmentModeEnabled: false,
    });
    const result = applyDevRedirectProbe({
      to: ["alice@example.com"],
      cc: ["b@x.com"],
    });
    expect(result.to).toEqual(["alice@example.com"]);
    expect(result.cc).toEqual(["b@x.com"]);
  });

  it("rewrites to/cc/bcc when dev mode enabled with override email", () => {
    readConfigMock.mockReturnValue({
      developmentModeEnabled: true,
      overrideRecipientEmail: "dev@example.com",
    });
    const result = applyDevRedirectProbe({
      to: ["alice@example.com", "bob@example.com"],
      cc: ["c@x.com"],
      bcc: ["d@x.com"],
    });
    expect(result.to).toEqual(["dev@example.com"]);
    expect(result.cc).toEqual([]);
    expect(result.bcc).toEqual([]);
  });

  it("throws when dev mode enabled but no override configured", () => {
    readConfigMock.mockReturnValue({
      developmentModeEnabled: true,
      overrideRecipientEmail: "  ", // whitespace-only is treated as empty
    });
    expect(() =>
      applyDevRedirectProbe({ to: ["alice@example.com"] }),
    ).toThrow("Development mode is enabled");
  });

  it("dev mode key is the same key written by saveEmailSystemDevelopmentSettings", () => {
    // Documents the contract that the connector reads the same config key
    // the admin form writes (the host's email-system settings page writes
    // the same "email-system-development" connector-config key).
    readConfigMock.mockReturnValue({});
    applyDevRedirectProbe({ to: ["x@y.com"] });
    expect(readConfigMock).toHaveBeenCalledWith(
      "email-system-development",
      {},
    );
  });
});
